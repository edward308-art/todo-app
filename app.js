// app.js — 할 일 관리 앱: 데이터 / 렌더링 / 이벤트 / 초기화

// ---------- Supabase 클라이언트 ----------

const SUPABASE_URL = "https://zhkyjljcgvkhylonevir.supabase.co";
const SUPABASE_KEY = "sb_publishable_xRDOJ2NDMM8AD6iBzn2Uyw_X7WEd2Vv";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- 상수 & 상태 ----------

const CATEGORY_LABELS = {
    work: "업무",
    personal: "개인",
    study: "공부",
};

// 자동 분류용 키워드 — 텍스트에 포함된 키워드 수가 가장 많은 카테고리로 분류한다.
const CATEGORY_KEYWORDS = {
    work: [
        "회의", "미팅", "보고서", "보고", "이메일", "메일", "발표", "프로젝트",
        "클라이언트", "고객", "업무", "출장", "결재", "기획", "마감", "회사",
        "팀", "거래처", "계약",
    ],
    study: [
        "공부", "강의", "수업", "시험", "과제", "숙제", "학습", "독서", "책",
        "영어", "수학", "국어", "인강", "복습", "예습", "학원", "자격증",
        "토익", "토플", "코딩", "논문",
    ],
    personal: [
        "운동", "헬스", "요가", "산책", "조깅", "쇼핑", "장보기", "약속", "친구",
        "가족", "영화", "여행", "식사", "점심", "저녁", "아침", "병원", "청소",
        "빨래", "은행", "미용실",
    ],
};

const AUTO_FALLBACK_CATEGORY = "personal";

let currentFilter = "all";

// DOM 참조 — DOMContentLoaded에서 채워진다.
let todoListEl;
let todoInputEl;
let categorySelectEl;
let addButtonEl;
let progressBarFillEl;
let progressTextEl;
let filterButtonEls;
let autoHintEl;

// ---------- 자동 카테고리 분류 ----------

function classifyByKeywords(text) {
    if (!text) return AUTO_FALLBACK_CATEGORY;
    const lower = text.toLowerCase();
    let best = AUTO_FALLBACK_CATEGORY;
    let bestScore = 0;
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        let score = 0;
        for (const kw of keywords) {
            if (lower.includes(kw.toLowerCase())) score++;
        }
        if (score > bestScore) {
            bestScore = score;
            best = category;
        }
    }
    return best;
}

function resolveCategory(selectValue, text) {
    return selectValue === "auto" ? classifyByKeywords(text) : selectValue;
}

// ---------- 데이터 계층 (Supabase) ----------

async function loadTodos() {
    const { data, error } = await db
        .from("todo")
        .select("*")
        .order("created_at", { ascending: true });
    if (error) { console.error("loadTodos:", error); return []; }
    return data;
}

async function addTodo(text, category) {
    const todo = {
        id: Date.now().toString(),
        text,
        category,
        completed: false,
        created_at: new Date().toISOString(),
    };
    const { data, error } = await db.from("todo").insert(todo).select().single();
    if (error) { console.error("addTodo:", error); return null; }
    return data;
}

async function updateTodo(id, newText, newCategory) {
    const { data, error } = await db
        .from("todo")
        .update({ text: newText, category: newCategory })
        .eq("id", id)
        .select()
        .single();
    if (error) { console.error("updateTodo:", error); return null; }
    return data;
}

async function deleteTodo(id) {
    const { error } = await db.from("todo").delete().eq("id", id);
    if (error) console.error("deleteTodo:", error);
}

async function toggleTodo(id, currentCompleted) {
    const { data, error } = await db
        .from("todo")
        .update({ completed: !currentCompleted })
        .eq("id", id)
        .select()
        .single();
    if (error) { console.error("toggleTodo:", error); return null; }
    return data;
}

// ---------- 렌더링 ----------

async function renderTodos() {
    const all = await loadTodos();
    const visible = currentFilter === "all"
        ? all
        : all.filter((t) => t.category === currentFilter);

    todoListEl.innerHTML = "";

    if (all.length === 0) {
        const empty = document.createElement("li");
        empty.className = "empty-state";
        empty.textContent = "아직 할 일이 없어요. 위에서 추가해보세요!";
        todoListEl.appendChild(empty);
    } else {
        for (const todo of visible) {
            todoListEl.appendChild(buildTodoItem(todo));
        }
    }

    updateProgress(all);
}

function buildTodoItem(todo) {
    const li = document.createElement("li");
    li.className = "todo-item";
    li.dataset.id = todo.id;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = todo.completed;
    checkbox.addEventListener("change", async () => {
        await toggleTodo(todo.id, todo.completed);
        await renderTodos();
    });

    const categoryEl = document.createElement("span");
    categoryEl.className = `category-label category-${todo.category}`;
    categoryEl.textContent = CATEGORY_LABELS[todo.category] ?? todo.category;

    const textEl = document.createElement("span");
    textEl.className = "todo-text";
    if (todo.completed) textEl.classList.add("completed");
    textEl.textContent = todo.text;

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "edit-button";
    editBtn.textContent = "수정";
    editBtn.addEventListener("click", () => startEdit(li, todo));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "delete-button";
    deleteBtn.textContent = "삭제";
    deleteBtn.addEventListener("click", async () => {
        await deleteTodo(todo.id);
        await renderTodos();
    });

    li.append(checkbox, categoryEl, textEl, editBtn, deleteBtn);
    return li;
}

function updateProgress(all) {
    const total = all.length;
    const done = all.filter((t) => t.completed).length;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);
    progressBarFillEl.style.width = percent + "%";
    progressTextEl.textContent = `${done} / ${total} 완료 (${percent}%)`;
}

function setFilter(filter) {
    currentFilter = filter;
    for (const btn of filterButtonEls) {
        btn.classList.toggle("active", btn.dataset.filter === filter);
    }
    renderTodos();
}

// ---------- 이벤트 핸들러 ----------

async function handleAdd() {
    const text = todoInputEl.value.trim();
    if (!text) return;
    const category = resolveCategory(categorySelectEl.value, text);
    await addTodo(text, category);
    todoInputEl.value = "";
    updateAutoHint();
    await renderTodos();
}

function updateAutoHint() {
    if (!autoHintEl) return;
    if (categorySelectEl.value !== "auto") {
        autoHintEl.hidden = true;
        return;
    }
    const text = todoInputEl.value.trim();
    if (!text) {
        autoHintEl.hidden = true;
        return;
    }
    const category = classifyByKeywords(text);
    autoHintEl.hidden = false;
    autoHintEl.textContent = `자동 분류: ${CATEGORY_LABELS[category]}`;
}

function startEdit(li, todo) {
    li.innerHTML = "";
    li.classList.add("editing");

    const input = document.createElement("input");
    input.type = "text";
    input.className = "edit-input";
    input.value = todo.text;

    const select = document.createElement("select");
    select.className = "edit-category";
    const autoOpt = document.createElement("option");
    autoOpt.value = "auto";
    autoOpt.textContent = "자동";
    select.appendChild(autoOpt);
    for (const [value, label] of Object.entries(CATEGORY_LABELS)) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        if (value === todo.category) opt.selected = true;
        select.appendChild(opt);
    }

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "저장";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "취소";

    const commit = async () => {
        const newText = input.value.trim();
        if (!newText) return;
        const newCategory = resolveCategory(select.value, newText);
        await updateTodo(todo.id, newText, newCategory);
        await renderTodos();
    };

    const cancel = () => renderTodos();

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

// ---------- 초기화 ----------

document.addEventListener("DOMContentLoaded", () => {
    todoListEl = document.getElementById("todo-list");
    todoInputEl = document.getElementById("todo-input");
    categorySelectEl = document.getElementById("category-select");
    addButtonEl = document.getElementById("add-button");
    progressBarFillEl = document.getElementById("progress-bar-fill");
    progressTextEl = document.getElementById("progress-text");
    filterButtonEls = document.querySelectorAll(".filter-button");
    autoHintEl = document.getElementById("auto-hint");

    addButtonEl.addEventListener("click", handleAdd);
    todoInputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleAdd();
    });
    todoInputEl.addEventListener("input", updateAutoHint);
    categorySelectEl.addEventListener("change", updateAutoHint);
    updateAutoHint();

    for (const btn of filterButtonEls) {
        btn.addEventListener("click", () => setFilter(btn.dataset.filter));
    }

    setFilter(currentFilter);
});
