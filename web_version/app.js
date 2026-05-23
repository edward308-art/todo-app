const STORAGE_KEY = "todos";

// ----- 매직 문자열 상수화 (Minor #11) -----
const FILTER_ALL = "all";
const CATEGORY_AUTO = "auto";
const AUTO_FALLBACK_CATEGORY = "personal";
const VALID_CATEGORIES = ["work", "personal", "study"];

const CATEGORY_LABELS = {
    work: "업무",
    personal: "개인",
    study: "공부",
};

const FILTER_TITLES = {
    all: "전체 할 일",
    work: "업무",
    personal: "개인",
    study: "공부",
};

// ----- 빈 상태 콘텐츠 (UX #4) -----
// 카테고리별로 다른 일러스트/제목/보조문구를 제공해 사용자에게 친근한 안내 제공.
// "할 일이 0개" 자체는 부정적 신호가 아니라 (다 끝냈거나, 새 카테고리에 진입한 상황) 긍정적/중립적
// 신호로 해석되도록 문구를 설계.
const EMPTY_STATES = {
    // 전체가 비어있을 때 = 최초 사용자/모두 삭제된 상태
    fresh: {
        icon: "📝",
        title: "아직 할 일이 없어요",
        subtext: "위 입력창에 첫 할 일을 적어볼까요?",
    },
    // 필터링 결과만 비어있는 경우 (할 일은 있지만 해당 카테고리에 없음)
    all:      { icon: "🎉", title: "모든 할 일을 끝냈어요!",   subtext: "잠시 한숨 돌리며 휴식해 보세요." },
    work:     { icon: "💼", title: "업무 할 일이 없어요",       subtext: "오늘은 업무 부담이 가벼운 날이네요." },
    personal: { icon: "🌿", title: "개인 일정이 비어있어요",   subtext: "여유 시간에 좋아하는 일을 해보는 건 어떨까요?" },
    study:    { icon: "📚", title: "공부 항목이 없어요",       subtext: "오늘 배우고 싶은 것을 적어보세요." },
};

// 토스트 자동 닫힘 시간 (ms). Nielsen Norman Group은 4~7초를 일반적인 toast 권장 범위로 제시.
const TOAST_DURATION_MS = 5000;

// ----- 키워드 사전 사전 정규화 (Minor #8) -----
// 각 키워드를 미리 toLowerCase 처리하여 classifyByKeywords 호출 시 반복 변환 비용 제거
const CATEGORY_KEYWORDS_RAW = {
    work: ["회의","미팅","보고서","보고","이메일","메일","발표","프로젝트","클라이언트","고객","업무","출장","결재","기획","마감","회사","팀","거래처","계약"],
    study: ["공부","강의","수업","시험","과제","숙제","학습","독서","책","영어","수학","국어","인강","복습","예습","학원","자격증","토익","토플","코딩","논문"],
    personal: ["운동","헬스","요가","산책","조깅","쇼핑","장보기","약속","친구","가족","영화","여행","식사","점심","저녁","아침","병원","청소","빨래","은행","미용실"],
};

// ----- Object.entries 캐싱 (Minor #9) -----
// classifyByKeywords가 호출될 때마다 Object.entries를 재생성하지 않도록 모듈 로드 시 1회만 생성
const CATEGORY_KEYWORD_ENTRIES = Object.entries(CATEGORY_KEYWORDS_RAW).map(
    ([category, keywords]) => [category, keywords.map((k) => k.toLowerCase())]
);

// ----- 인메모리 상태 캐시 (Major #3) -----
// 단일 사실 원천(single source of truth). 모든 mutation은 이 배열을 직접 갱신하고
// localStorage에 동기화하므로, 매 작업마다 JSON.parse를 반복하지 않는다.
let todos = [];
let currentFilter = FILTER_ALL;
let lastProgressPercent = -1; // progressBarFill 변경 감지용 (Minor #12)
let autoHintTimerId = null;   // updateAutoHint 디바운스용 (Minor #10)

let todoListEl, todoInputEl, categorySelectEl, addButtonEl, inputFormEl;
let progressBarFillEl, progressTextEl, filterButtonEls, autoHintEl;
let listTitleEl, listMetaEl, statTotalEl, statDoneEl, statRemainingEl, countEls;
let toastContainerEl, srLiveEl;

// 다음 렌더 시 강조 표시할 todo id (추가/완료 마이크로 인터랙션용)
let pendingHighlightId = null;
let pendingHighlightType = null; // "added" | "completed"

// ----- 카테고리 정규화 (Major #6) -----
// 알 수 없는 카테고리 값(예: 손상된 localStorage, 구버전 데이터)은 fallback 처리
function normalizeCategory(category) {
    return VALID_CATEGORIES.includes(category) ? category : AUTO_FALLBACK_CATEGORY;
}

function classifyByKeywords(text) {
    if (!text) return AUTO_FALLBACK_CATEGORY;
    const lower = text.toLowerCase();
    let best = AUTO_FALLBACK_CATEGORY;
    let bestScore = 0;
    for (const [category, keywords] of CATEGORY_KEYWORD_ENTRIES) {
        let score = 0;
        for (const kw of keywords) {
            if (lower.includes(kw)) score++;
        }
        if (score > bestScore) { bestScore = score; best = category; }
    }
    return best;
}

function resolveCategory(selectValue, text) {
    return selectValue === CATEGORY_AUTO ? classifyByKeywords(text) : selectValue;
}

// ----- ID 생성 (Critical #2) -----
// Date.now() 단독은 같은 ms에 호출되면 충돌 가능. crypto.randomUUID() 우선,
// 미지원 환경(구형 브라우저)은 randomness 결합으로 fallback.
function generateId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ----- 영속화 (Critical #1) -----
// loadTodos는 앱 시작 시 1회만 호출. JSON 파싱 예외 + 배열 검증 + 각 항목 카테고리 정규화.
function loadTodos() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            console.warn("저장된 todos가 배열이 아닙니다. 초기화합니다.");
            return [];
        }
        // 각 항목의 카테고리를 정규화해 두면 이후 렌더에서 별도 검증이 불필요
        return parsed.map((t) => ({
            ...t,
            category: normalizeCategory(t.category),
        }));
    } catch (err) {
        console.error("todos 파싱 실패:", err);
        return [];
    }
}

function saveTodos() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
}

// ----- Mutation 함수들: 인메모리 캐시 직접 수정 -----
function addTodo(text, category) {
    const todo = {
        id: generateId(),
        text,
        category,
        completed: false,
        createdAt: new Date().toISOString(),
    };
    todos.push(todo);
    saveTodos();
    return todo;
}

function updateTodo(id, newText, newCategory) {
    const todo = todos.find((t) => t.id === id);
    if (!todo) return null;
    todo.text = newText;
    todo.category = newCategory;
    saveTodos();
    return todo;
}

function deleteTodo(id) {
    todos = todos.filter((t) => t.id !== id);
    saveTodos();
}

function toggleTodo(id) {
    const todo = todos.find((t) => t.id === id);
    if (!todo) return null;
    todo.completed = !todo.completed;
    saveTodos();
    return todo;
}

// ----- 렌더링 (Major #5) -----
// DocumentFragment + replaceChildren로 단일 reflow 보장.
// innerHTML = "" 후 append 반복하던 기존 방식보다 DOM 작업이 일관성 있고 빠르다.
function renderTodos() {
    const visible = currentFilter === FILTER_ALL
        ? todos
        : todos.filter((t) => t.category === currentFilter);

    const fragment = document.createDocumentFragment();
    if (visible.length === 0) {
        fragment.appendChild(buildEmptyState());
    } else {
        for (const todo of visible) {
            fragment.appendChild(buildTodoItem(todo));
        }
    }
    todoListEl.replaceChildren(fragment);

    // ----- 마이크로 인터랙션 강조 (UX #2, #3) -----
    // 추가/완료 직후의 항목 1건에만 일회성 애니메이션 클래스를 부여.
    // 클래스는 애니메이션이 끝나면 자동 제거되므로 다음 렌더에 영향 없음.
    if (pendingHighlightId && pendingHighlightType) {
        const li = todoListEl.querySelector(`.todo-item[data-id="${cssEscape(pendingHighlightId)}"]`);
        if (li) {
            const cls = pendingHighlightType === "added" ? "just-added" : "just-completed";
            li.classList.add(cls);
            li.addEventListener("animationend", () => li.classList.remove(cls), { once: true });
        }
        pendingHighlightId = null;
        pendingHighlightType = null;
    }

    updateProgress();
    updateCounts();
    updateListHeader(visible.length);
}

// data-id 값이 특수문자를 포함하지 않는다는 가정이지만, generateId()의 UUID 하이픈 안전성을 위해 보호
function cssEscape(str) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(str);
    }
    return String(str).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

// ----- 빈 상태 빌더 (UX #4) -----
function buildEmptyState() {
    const li = document.createElement("li");
    li.className = "empty-state";

    // 컨텍스트 판별: 데이터 자체가 없으면 fresh, 필터링 결과만 비어있으면 카테고리별 메시지
    const ctx = todos.length === 0
        ? EMPTY_STATES.fresh
        : (EMPTY_STATES[currentFilter] ?? EMPTY_STATES.all);

    const icon = document.createElement("div");
    icon.className = "empty-illustration";
    icon.setAttribute("aria-hidden", "true"); // 장식용 이모지는 스크린리더에서 제외
    icon.textContent = ctx.icon;

    const title = document.createElement("p");
    title.className = "empty-title";
    title.textContent = ctx.title;

    const sub = document.createElement("p");
    sub.className = "empty-subtext";
    sub.textContent = ctx.subtext;

    li.append(icon, title, sub);
    return li;
}

// ----- 항목 빌더 (Major #4) -----
// 더 이상 항목별로 4개 리스너를 달지 않는다. data-action 속성만 부여하고,
// 클릭/변경은 todoListEl의 위임 리스너가 처리한다.
function buildTodoItem(todo) {
    const li = document.createElement("li");
    li.className = "todo-item";
    if (todo.completed) li.classList.add("is-completed");
    li.dataset.id = todo.id;

    // 행 전체에 의미를 부여: 스크린리더에서 항목 단위로 읽힘
    const categoryName = CATEGORY_LABELS[todo.category] ?? todo.category;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = todo.completed;
    checkbox.dataset.action = "toggle";
    // 체크박스도 어떤 항목인지 음성 안내
    checkbox.setAttribute(
        "aria-label",
        `${todo.text} ${todo.completed ? "완료 상태. 미완료로 표시" : "미완료 상태. 완료로 표시"}`
    );

    const categoryEl = document.createElement("span");
    categoryEl.className = `category-label category-${todo.category}`;
    categoryEl.textContent = categoryName;

    const textEl = document.createElement("span");
    textEl.className = "todo-text";
    if (todo.completed) textEl.classList.add("completed");
    textEl.textContent = todo.text;

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "edit-button";
    editBtn.dataset.action = "edit";
    editBtn.textContent = "수정";
    // 접근성 (UX #5): 스크린리더가 "수정"만 듣지 않도록 항목 컨텍스트 포함
    editBtn.setAttribute("aria-label", `'${todo.text}' 수정`);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "delete-button";
    deleteBtn.dataset.action = "delete";
    deleteBtn.textContent = "삭제";
    deleteBtn.setAttribute("aria-label", `'${todo.text}' 삭제`);

    li.append(checkbox, categoryEl, textEl, editBtn, deleteBtn);
    return li;
}

// ----- 위임 핸들러 (Major #4) -----
function handleListClick(e) {
    const target = e.target;
    const action = target.dataset && target.dataset.action;
    if (!action) return;
    const li = target.closest(".todo-item");
    if (!li) return;
    const id = li.dataset.id;
    if (!id) return;

    if (action === "edit") {
        const todo = todos.find((t) => t.id === id);
        if (todo) startEdit(li, todo);
    } else if (action === "delete") {
        // 삭제 UX 개선 (UX #1): 즉시 파기하지 않고 스냅샷을 보관하여 Undo 토스트 제공
        const idx = todos.findIndex((t) => t.id === id);
        if (idx === -1) return;
        const snapshot = { todo: todos[idx], index: idx };
        deleteTodo(id);
        renderTodos();
        announce(`'${snapshot.todo.text}' 삭제됨`);
        showUndoToast(snapshot);
    }
}

function handleListChange(e) {
    const target = e.target;
    if (target.dataset && target.dataset.action === "toggle") {
        const li = target.closest(".todo-item");
        if (!li) return;
        const id = li.dataset.id;
        const result = toggleTodo(id);
        // UX #3: 미완료 → 완료 전환 시에만 축하 애니메이션 (반대 방향은 조용히 처리)
        if (result && result.completed) {
            pendingHighlightId = id;
            pendingHighlightType = "completed";
            announce(`'${result.text}' 완료 표시`);
        } else if (result) {
            announce(`'${result.text}' 미완료로 되돌림`);
        }
        renderTodos();
    }
}

// ----- 진행률 (Minor #12) -----
// 동일한 percent면 width DOM 갱신을 건너뛴다. 텍스트/통계는 항상 갱신
// (total/done 자체는 바뀌지 않아도 다른 호출 경로에서 호출될 수 있어 안전하게 유지).
function updateProgress() {
    const total = todos.length;
    let done = 0;
    for (const t of todos) if (t.completed) done++;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);

    if (percent !== lastProgressPercent) {
        progressBarFillEl.style.width = percent + "%";
        lastProgressPercent = percent;
    }
    progressTextEl.textContent = `${done} / ${total} 완료 (${percent}%)`;
    statTotalEl.textContent = total;
    statDoneEl.textContent = done;
    statRemainingEl.textContent = total - done;
}

// ----- 카운트 (Major #6 적용) -----
function updateCounts() {
    const counts = { all: todos.length, work: 0, personal: 0, study: 0 };
    for (const t of todos) {
        const cat = normalizeCategory(t.category);
        counts[cat]++;
    }
    for (const key in countEls) {
        countEls[key].textContent = counts[key];
    }
}

function updateListHeader(visibleCount) {
    listTitleEl.textContent = FILTER_TITLES[currentFilter] ?? "할 일";
    listMetaEl.textContent = `${visibleCount}개`;
}

function setFilter(filter) {
    currentFilter = filter;
    for (const btn of filterButtonEls) {
        btn.classList.toggle("active", btn.dataset.filter === filter);
    }
    renderTodos();
}

// ----- 추가 (form submit 기반) -----
function handleAdd() {
    const text = todoInputEl.value.trim();
    if (!text) {
        // 빈 입력 시각적 피드백
        todoInputEl.classList.add("input-error");
        todoInputEl.focus();
        return;
    }
    todoInputEl.classList.remove("input-error");
    const category = resolveCategory(categorySelectEl.value, text);
    const newTodo = addTodo(text, category);
    todoInputEl.value = "";
    updateAutoHintImmediate();

    // UX #2: 추가 성공 피드백
    // 1) 추가 버튼에 짧은 펄스 효과
    // 2) 새 항목 행에 슬라이드 인 애니메이션 (renderTodos 안에서 적용)
    // 3) 스크린리더 공지
    if (addButtonEl) {
        addButtonEl.classList.remove("is-pulsing");
        // 강제 리플로우로 같은 클래스를 연속 추가해도 애니메이션 재실행
        void addButtonEl.offsetWidth;
        addButtonEl.classList.add("is-pulsing");
        addButtonEl.addEventListener(
            "animationend",
            () => addButtonEl.classList.remove("is-pulsing"),
            { once: true }
        );
    }
    pendingHighlightId = newTodo.id;
    pendingHighlightType = "added";
    announce(`'${newTodo.text}' ${CATEGORY_LABELS[newTodo.category] ?? ""} 카테고리로 추가됨`);

    renderTodos();
}

// ----- 스크린리더 공지 헬퍼 -----
// aria-live="polite" 영역에 텍스트를 잠시 넣었다가 비워, 변경을 음성으로 안내.
function announce(message) {
    if (!srLiveEl) return;
    // 같은 메시지가 연속해서 announce될 때도 변경 이벤트가 발생하도록 한 번 비웠다 채움
    srLiveEl.textContent = "";
    // 마이크로 태스크 후 설정해야 변경으로 인식됨
    setTimeout(() => { srLiveEl.textContent = message; }, 30);
}

// ----- 토스트 / Undo (UX #1) -----
// 일회성 토스트 1건만 화면에 노출. 새 토스트가 뜨면 이전 토스트는 즉시 닫힘.
let activeToast = null;
let activeToastTimer = null;

function showUndoToast(snapshot) {
    dismissActiveToast(true); // 기존 토스트 즉시 정리 (스택 누적 방지)

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.setAttribute("role", "alert"); // 즉시 안내가 필요한 일시적 메시지

    const msg = document.createElement("span");
    msg.className = "toast-message";
    msg.textContent = `'${truncate(snapshot.todo.text, 24)}' 삭제됨`;

    const undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.className = "toast-action";
    undoBtn.textContent = "실행취소";
    undoBtn.setAttribute("aria-label", `'${snapshot.todo.text}' 삭제 실행취소`);
    undoBtn.addEventListener("click", () => {
        // 원래 위치(가능하면)에 복구. 인덱스 범위 초과 시 끝에 append.
        const insertAt = Math.min(snapshot.index, todos.length);
        todos.splice(insertAt, 0, snapshot.todo);
        saveTodos();
        announce(`'${snapshot.todo.text}' 복구됨`);
        dismissActiveToast(true);
        renderTodos();
    });

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "toast-close";
    closeBtn.setAttribute("aria-label", "알림 닫기");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => dismissActiveToast(false));

    toast.append(msg, undoBtn, closeBtn);
    toastContainerEl.appendChild(toast);
    activeToast = toast;

    activeToastTimer = setTimeout(() => dismissActiveToast(false), TOAST_DURATION_MS);
}

function dismissActiveToast(immediate) {
    if (activeToastTimer) {
        clearTimeout(activeToastTimer);
        activeToastTimer = null;
    }
    if (!activeToast) return;
    const t = activeToast;
    activeToast = null;
    if (immediate) {
        t.remove();
        return;
    }
    t.classList.add("is-leaving");
    t.addEventListener("animationend", () => t.remove(), { once: true });
}

// 토스트 메시지에 들어갈 항목명이 너무 길면 잘라 표시
function truncate(str, max) {
    return str.length > max ? str.slice(0, max) + "…" : str;
}

// ----- 자동 분류 힌트 (Minor #10 디바운스) -----
function updateAutoHintImmediate() {
    if (!autoHintEl) return;
    if (categorySelectEl.value !== CATEGORY_AUTO) { autoHintEl.hidden = true; return; }
    const text = todoInputEl.value.trim();
    if (!text) { autoHintEl.hidden = true; return; }
    const category = classifyByKeywords(text);
    autoHintEl.hidden = false;
    autoHintEl.textContent = `자동 분류: ${CATEGORY_LABELS[category]}`;
}

function updateAutoHint() {
    // 빠른 연속 입력에서 keyword 매칭(O(키워드 수))을 매 키 입력마다 돌리지 않도록 100ms 디바운스
    if (autoHintTimerId !== null) clearTimeout(autoHintTimerId);
    autoHintTimerId = setTimeout(() => {
        autoHintTimerId = null;
        updateAutoHintImmediate();
    }, 100);
}

// ----- 편집 모드 (Major #7 빈 값 피드백) -----
function startEdit(li, todo) {
    li.replaceChildren();
    li.classList.add("editing");

    const input = document.createElement("input");
    input.type = "text";
    input.className = "edit-input";
    input.value = todo.text;

    const select = document.createElement("select");
    select.className = "edit-category";
    const autoOpt = document.createElement("option");
    autoOpt.value = CATEGORY_AUTO;
    autoOpt.textContent = "자동";
    select.appendChild(autoOpt);
    for (const value of VALID_CATEGORIES) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = CATEGORY_LABELS[value];
        if (value === todo.category) opt.selected = true;
        select.appendChild(opt);
    }

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "저장";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "취소";

    const commit = () => {
        const newText = input.value.trim();
        if (!newText) {
            // 빈 값 저장 시도: 무반응 대신 명시적 피드백
            input.classList.add("input-error");
            input.focus();
            return;
        }
        updateTodo(todo.id, newText, resolveCategory(select.value, newText));
        renderTodos();
    };
    const cancel = () => renderTodos();

    // 사용자 수정 시 에러 표시 제거
    input.addEventListener("input", () => input.classList.remove("input-error"));

    saveBtn.addEventListener("click", commit);
    cancelBtn.addEventListener("click", cancel);
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") cancel();
    });

    li.append(input, select, saveBtn, cancelBtn);
    input.focus();
    input.select();
}

document.addEventListener("DOMContentLoaded", () => {
    todoListEl = document.getElementById("todo-list");
    todoInputEl = document.getElementById("todo-input");
    categorySelectEl = document.getElementById("category-select");
    addButtonEl = document.getElementById("add-button");
    inputFormEl = document.getElementById("input-form");
    progressBarFillEl = document.getElementById("progress-bar-fill");
    progressTextEl = document.getElementById("progress-text");
    filterButtonEls = document.querySelectorAll(".filter-button");
    autoHintEl = document.getElementById("auto-hint");
    listTitleEl = document.getElementById("list-title");
    listMetaEl = document.getElementById("list-meta");
    statTotalEl = document.getElementById("stat-total");
    statDoneEl = document.getElementById("stat-done");
    statRemainingEl = document.getElementById("stat-remaining");
    countEls = {
        all: document.getElementById("count-all"),
        work: document.getElementById("count-work"),
        personal: document.getElementById("count-personal"),
        study: document.getElementById("count-study"),
    };
    toastContainerEl = document.getElementById("toast-container");
    srLiveEl = document.getElementById("sr-live");

    // 초기 1회 로드 → 이후엔 인메모리 캐시만 사용
    todos = loadTodos();

    // form submit으로 시맨틱하게 추가 처리 (Enter/버튼 모두 단일 경로)
    if (inputFormEl) {
        inputFormEl.addEventListener("submit", (e) => {
            e.preventDefault();
            handleAdd();
        });
    } else {
        // form 시맨틱이 없을 경우의 fallback
        addButtonEl.addEventListener("click", handleAdd);
        todoInputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") handleAdd();
        });
    }

    // 입력 시 에러 표시 제거 + 자동 힌트 갱신
    todoInputEl.addEventListener("input", () => {
        todoInputEl.classList.remove("input-error");
        updateAutoHint();
    });
    categorySelectEl.addEventListener("change", updateAutoHintImmediate);

    // 위임 리스너: 항목 개수에 무관하게 리스너 2개만 유지
    todoListEl.addEventListener("click", handleListClick);
    todoListEl.addEventListener("change", handleListChange);

    updateAutoHintImmediate();

    for (const btn of filterButtonEls) {
        btn.addEventListener("click", () => setFilter(btn.dataset.filter));
    }
    setFilter(currentFilter);
});
