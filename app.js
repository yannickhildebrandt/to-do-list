import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js';
import {
  getFirestore, collection, query, where, orderBy, getDocs,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js';

// ── Firebase Config ──
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCYa9zSpB_BaBuR1_GR9x5kw6SywUW2CD4",
  authDomain: "to-do-list-a3017.firebaseapp.com",
  projectId: "to-do-list-a3017",
  storageBucket: "to-do-list-a3017.firebasestorage.app",
  messagingSenderId: "65448676063",
  appId: "1:65448676063:web:1774d5d4df5c97ad96776a"
};

// ── State ──
let db = null;
let app = null;
let currentWeek = 0;
let currentYear = 0;
let categories = new Map(); // id -> {name, color}
let todos = [];
let selectedPriority = 'high';
let voiceSelectedPriority = 'medium';
let isRecording = false;
let recognition = null;

// ── ISO Week helpers ──
function getISOWeekData(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { week, year: d.getUTCFullYear() };
}

function getMondayOfISOWeek(week, year) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7);
  return monday;
}

function adjustWeek(week, year, delta) {
  const monday = getMondayOfISOWeek(week, year);
  monday.setUTCDate(monday.getUTCDate() + delta * 7);
  return getISOWeekData(monday);
}

// ── Init ──
const today = getISOWeekData(new Date());
currentWeek = today.week;
currentYear = today.year;

window.addEventListener('DOMContentLoaded', () => {
  updateWeekLabel();
  initFirebase(FIREBASE_CONFIG);
});

function initFirebase(config) {
  try {
    app = initializeApp(config);
    db = getFirestore(app);
    loadCategories().then(() => loadAndRender()).catch(e => {
      console.error('Firestore load error:', e);
      alert('Firestore-Fehler: ' + e.message);
    });
  } catch (e) {
    console.error('Firebase init error:', e);
    alert('Firebase-Fehler: ' + e.message);
  }
}

// ── Firebase CRUD ──
async function loadCategories() {
  categories.clear();
  const snap = await getDocs(collection(db, 'categories'));
  snap.forEach(d => categories.set(d.id, d.data()));
  rebuildCategoryDropdowns();
}

async function loadTodos() {
  todos = [];
  const q = query(
    collection(db, 'todos'),
    where('year', '==', currentYear),
    where('week', '==', currentWeek),
    orderBy('createdAt')
  );
  const snap = await getDocs(q);
  snap.forEach(d => todos.push({ id: d.id, ...d.data() }));
}

async function loadAndRender() {
  await loadTodos();
  renderTodos();
}

async function createTodo(text, categoryId, priority) {
  await addDoc(collection(db, 'todos'), {
    text,
    categoryId: categoryId || null,
    priority,
    week: currentWeek,
    year: currentYear,
    done: false,
    createdAt: serverTimestamp()
  });
  await loadAndRender();
}

async function toggleTodo(id, done) {
  await updateDoc(doc(db, 'todos', id), { done: !done });
  await loadAndRender();
}

async function deleteTodo(id) {
  await deleteDoc(doc(db, 'todos', id));
  await loadAndRender();
}

async function createCategory(name, color) {
  const ref = await addDoc(collection(db, 'categories'), { name, color });
  categories.set(ref.id, { name, color });
  rebuildCategoryDropdowns();
  return ref.id;
}

async function deleteCategory(id) {
  await deleteDoc(doc(db, 'categories', id));
  categories.delete(id);
  rebuildCategoryDropdowns();
  renderTodos();
}

// ── Rendering ──
function updateWeekLabel() {
  document.getElementById('weekLabel').textContent = `KW ${currentWeek} / ${currentYear}`;
}

function rebuildCategoryDropdowns() {
  ['taskCategory', 'voiceTaskCategory'].forEach(selId => {
    const sel = document.getElementById(selId);
    const val = sel.value;
    sel.innerHTML = '<option value="">— Keine —</option>';
    for (const [id, cat] of categories) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = cat.name;
      sel.appendChild(opt);
    }
    const newOpt = document.createElement('option');
    newOpt.value = '__new__';
    newOpt.textContent = '+ Neue Kategorie';
    sel.appendChild(newOpt);
    sel.value = val;
  });
}

function renderTodos() {
  const container = document.getElementById('todoContainer');
  const emptyState = document.getElementById('emptyState');
  container.innerHTML = '';

  if (todos.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  // Group by category
  const groups = new Map();
  for (const t of todos) {
    const key = t.categoryId || '__none__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  // Sort within groups: incomplete first, then by priority, then by createdAt
  const prioOrder = { high: 0, medium: 1, low: 2 };
  for (const items of groups.values()) {
    items.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return (prioOrder[a.priority] || 1) - (prioOrder[b.priority] || 1);
    });
  }

  // Render categorized groups first, then uncategorized
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    if (a === '__none__') return 1;
    if (b === '__none__') return -1;
    const catA = categories.get(a);
    const catB = categories.get(b);
    return (catA?.name || '').localeCompare(catB?.name || '');
  });

  for (const key of sortedKeys) {
    const section = document.createElement('div');
    section.className = 'category-section';

    const header = document.createElement('div');
    header.className = 'category-header';
    if (key === '__none__') {
      header.textContent = 'Ohne Kategorie';
    } else {
      const cat = categories.get(key);
      const dot = document.createElement('span');
      dot.className = 'category-color-dot';
      dot.style.background = cat?.color || '#999';
      header.appendChild(dot);
      header.appendChild(document.createTextNode(cat?.name || 'Unbekannt'));
    }
    section.appendChild(header);

    for (const todo of groups.get(key)) {
      section.appendChild(createTodoElement(todo));
    }
    container.appendChild(section);
  }
}

function createTodoElement(todo) {
  const card = document.createElement('div');
  card.className = 'todo-card' + (todo.done ? ' done' : '');
  const cat = categories.get(todo.categoryId);
  if (cat) {
    card.setAttribute('data-color', '1');
    card.style.borderLeftColor = cat.color;
  }

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'todo-checkbox';
  cb.checked = todo.done;
  cb.addEventListener('change', () => toggleTodo(todo.id, todo.done));

  const text = document.createElement('span');
  text.className = 'todo-text';
  text.textContent = todo.text;

  const prio = document.createElement('span');
  prio.className = `priority-dot priority--${todo.priority || 'medium'}`;
  prio.title = todo.priority || 'medium';

  const del = document.createElement('button');
  del.className = 'todo-delete';
  del.textContent = '×';
  del.addEventListener('click', () => deleteTodo(todo.id));

  card.append(cb, text, prio, del);
  return card;
}

// ── Week navigation ──
window.prevWeek = function () {
  const { week, year } = adjustWeek(currentWeek, currentYear, -1);
  currentWeek = week;
  currentYear = year;
  updateWeekLabel();
  if (db) loadAndRender();
};

window.nextWeek = function () {
  const { week, year } = adjustWeek(currentWeek, currentYear, 1);
  currentWeek = week;
  currentYear = year;
  updateWeekLabel();
  if (db) loadAndRender();
};

window.goToCurrentWeek = function () {
  const t = getISOWeekData(new Date());
  currentWeek = t.week;
  currentYear = t.year;
  updateWeekLabel();
  if (db) loadAndRender();
};

// ── Settings ──
window.openSettings = function () {
  const key = localStorage.getItem('wt_claude_api_key');
  if (key) document.getElementById('claudeKey').value = key;
  document.getElementById('settingsModal').classList.add('open');
};

window.closeSettings = function () {
  document.getElementById('settingsModal').classList.remove('open');
};

window.saveSettings = function () {
  const key = document.getElementById('claudeKey').value.trim();
  if (key) localStorage.setItem('wt_claude_api_key', key);
  closeSettings();
};

// ── Add Task Modal ──
window.openAddTask = function () {
  document.getElementById('taskText').value = '';
  document.getElementById('taskCategory').value = '';
  document.getElementById('newCategoryFields').classList.add('hidden');
  selectPriority('high');
  document.getElementById('addTaskModal').classList.add('open');
  document.getElementById('taskText').focus();
};

window.closeAddTask = function () {
  document.getElementById('addTaskModal').classList.remove('open');
};

window.selectPriority = function (p) {
  selectedPriority = p;
  document.querySelectorAll('#addTaskModal .priority-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.priority === p);
  });
};

document.getElementById('taskCategory').addEventListener('change', (e) => {
  document.getElementById('newCategoryFields').classList.toggle('hidden', e.target.value !== '__new__');
});

document.getElementById('voiceTaskCategory').addEventListener('change', (e) => {
  document.getElementById('voiceNewCategoryFields').classList.toggle('hidden', e.target.value !== '__new__');
});

window.saveTask = async function () {
  const text = document.getElementById('taskText').value.trim();
  if (!text) return;
  let categoryId = document.getElementById('taskCategory').value;
  if (categoryId === '__new__') {
    const name = document.getElementById('newCatName').value.trim();
    const color = document.getElementById('newCatColor').value;
    if (!name) return alert('Bitte Kategorie-Name eingeben.');
    categoryId = await createCategory(name, color);
  }
  await createTodo(text, categoryId || null, selectedPriority);
  closeAddTask();
};

// ── Voice Input ──
window.startVoice = function () {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert('Spracherkennung wird in diesem Browser nicht unterstützt. Bitte Chrome oder Edge verwenden.');
    return;
  }

  const micBtn = document.getElementById('micBtn');

  if (isRecording && recognition) {
    recognition.stop();
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'de-DE';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isRecording = true;
    micBtn.classList.add('recording');
  };

  recognition.onresult = async (event) => {
    const transcript = event.results[0][0].transcript;
    isRecording = false;
    micBtn.classList.remove('recording');
    await processVoiceInput(transcript);
  };

  recognition.onerror = (event) => {
    isRecording = false;
    micBtn.classList.remove('recording');
    if (event.error !== 'aborted') {
      alert('Sprachfehler: ' + event.error);
    }
  };

  recognition.onend = () => {
    isRecording = false;
    micBtn.classList.remove('recording');
  };

  recognition.start();
};

async function processVoiceInput(transcript) {
  const apiKey = localStorage.getItem('wt_claude_api_key');
  if (!apiKey) {
    // Fallback: open manual form with transcript
    openAddTask();
    document.getElementById('taskText').value = transcript;
    return;
  }

  showStatus('Analysiere mit Claude...');

  const categoryNames = [...categories.values()].map(c => c.name);
  const systemPrompt = `Du extrahierst Aufgaben aus deutscher Spracheingabe. Antworte NUR mit validem JSON, kein anderer Text.

Bestehende Kategorien: ${JSON.stringify(categoryNames)}

Antwort-Schema:
{"text": "Aufgabenbeschreibung", "category": "Kategoriename oder null", "priority": "high|medium|low"}

Regeln:
- "text": Die eigentliche Aufgabe, bereinigt und klar formuliert.
- "category": Wenn der Sprecher einen Kunden oder ein Thema erwähnt, ordne es einer bestehenden Kategorie zu. Wenn keine passt, schlage einen neuen Kategorienamen vor. Wenn unklar, setze null.
- "priority": Wenn Priorität erwähnt wird (hoch, wichtig, dringend = high; mittel = medium; niedrig, kann warten = low), nutze diese. Standard ist "medium".`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: 'user', content: transcript }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(err);
    }

    const data = await response.json();
    const content = data.content[0].text;
    const parsed = JSON.parse(content);

    hideStatus();
    openVoiceConfirmation(transcript, parsed);
  } catch (e) {
    hideStatus();
    console.error('Claude API error:', e);
    // Fallback to manual
    openAddTask();
    document.getElementById('taskText').value = transcript;
  }
}

function openVoiceConfirmation(transcript, parsed) {
  document.getElementById('voiceTranscript').textContent = `"${transcript}"`;
  document.getElementById('voiceTaskText').value = parsed.text || transcript;

  // Try to match category
  let matchedCatId = '';
  if (parsed.category) {
    for (const [id, cat] of categories) {
      if (cat.name.toLowerCase() === parsed.category.toLowerCase()) {
        matchedCatId = id;
        break;
      }
    }
    if (!matchedCatId && parsed.category) {
      // Suggest new category
      document.getElementById('voiceTaskCategory').value = '__new__';
      document.getElementById('voiceNewCategoryFields').classList.remove('hidden');
      document.getElementById('voiceNewCatName').value = parsed.category;
    }
  }
  if (matchedCatId) {
    document.getElementById('voiceTaskCategory').value = matchedCatId;
    document.getElementById('voiceNewCategoryFields').classList.add('hidden');
  } else if (!parsed.category) {
    document.getElementById('voiceTaskCategory').value = '';
    document.getElementById('voiceNewCategoryFields').classList.add('hidden');
  }

  selectVoicePriority(parsed.priority || 'medium');
  document.getElementById('voiceModal').classList.add('open');
}

window.closeVoiceModal = function () {
  document.getElementById('voiceModal').classList.remove('open');
};

window.selectVoicePriority = function (p) {
  voiceSelectedPriority = p;
  document.querySelectorAll('#voicePriorityButtons .priority-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.priority === p);
  });
};

window.saveVoiceTask = async function () {
  const text = document.getElementById('voiceTaskText').value.trim();
  if (!text) return;
  let categoryId = document.getElementById('voiceTaskCategory').value;
  if (categoryId === '__new__') {
    const name = document.getElementById('voiceNewCatName').value.trim();
    const color = document.getElementById('voiceNewCatColor').value;
    if (!name) return alert('Bitte Kategorie-Name eingeben.');
    categoryId = await createCategory(name, color);
  }
  await createTodo(text, categoryId || null, voiceSelectedPriority);
  closeVoiceModal();
};

// ── Category Management ──
window.openCategoryModal = function () {
  renderCategoryList();
  document.getElementById('categoryModal').classList.add('open');
};

window.closeCategoryModal = function () {
  document.getElementById('categoryModal').classList.remove('open');
};

function renderCategoryList() {
  const list = document.getElementById('categoryList');
  list.innerHTML = '';
  for (const [id, cat] of categories) {
    const row = document.createElement('div');
    row.className = 'cat-mgmt-row';

    const dot = document.createElement('span');
    dot.className = 'category-color-dot';
    dot.style.background = cat.color;

    const name = document.createElement('span');
    name.className = 'cat-mgmt-name';
    name.textContent = cat.name;

    const del = document.createElement('button');
    del.className = 'cat-mgmt-delete';
    del.textContent = '×';
    del.addEventListener('click', () => deleteCategory(id).then(renderCategoryList));

    row.append(dot, name, del);
    list.appendChild(row);
  }
  if (categories.size === 0) {
    list.innerHTML = '<p class="hint">Noch keine Kategorien.</p>';
  }
}

window.addCategoryFromMgmt = async function () {
  const name = document.getElementById('mgmtNewCatName').value.trim();
  const color = document.getElementById('mgmtNewCatColor').value;
  if (!name) return;
  try {
    await createCategory(name, color);
    document.getElementById('mgmtNewCatName').value = '';
    renderCategoryList();
  } catch (e) {
    console.error('Category create error:', e);
    alert('Fehler beim Erstellen: ' + e.message);
  }
};

// ── Status overlay ──
function showStatus(msg) {
  document.getElementById('statusText').textContent = msg;
  document.getElementById('statusOverlay').classList.remove('hidden');
}

function hideStatus() {
  document.getElementById('statusOverlay').classList.add('hidden');
}

// ── Keyboard: Enter to save in add task modal ──
document.getElementById('taskText').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveTask();
});

document.getElementById('voiceTaskText').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveVoiceTask();
});
