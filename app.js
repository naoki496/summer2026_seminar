"use strict";

const QUESTION_TIME_SEC = 30;
const WARN_AT_SEC = 5;
const RANDOM_QUESTION_COUNT = 10;
const MARKS = ["①", "②", "③", "④"];

const AUDIO_FILES = {
  bgm: "./assets/bgm.mp3",
  correct: "./assets/correct.mp3",
  wrong: "./assets/wrong.mp3",
  go: "./assets/go.mp3",
};

let questions = [];
let order = [];
let currentIndex = 0;
let score = 0;
let history = [];
let locked = false;
let currentMode = "random";
let timerId = null;
let timerEndAt = 0;
let bgmOn = true;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const startScreen = $("#startScreen");
const app = $("#app");
const quizPanel = $("#quizPanel");
const randomModeBtn = $("#randomModeBtn");
const allModeBtn = $("#allModeBtn");
const modeLabel = $("#modeLabel");
const progress = $("#progress");
const scoreEl = $("#score");
const progressBar = $("#progressBar");
const timerTrack = $("#timerTrack");
const timerBar = $("#timerBar");
const timerText = $("#timerText");
const originalQuestionNo = $("#originalQuestionNo");
const sourceEl = $("#source");
const questionEl = $("#question");
const choiceButtons = $$(".choice");
const feedback = $("#feedback");
const feedbackTitle = $("#feedbackTitle");
const correctAnswer = $("#correctAnswer");
const explanationEl = $("#explanation");
const nextBtn = $("#nextBtn");
const restartBtn = $("#restartBtn");
const bgmToggle = $("#bgmToggle");
const countdownOverlay = $("#countdownOverlay");
const countdownNumber = $("#countdownNumber");
const resultOverlay = $("#resultOverlay");
const resultScore = $("#resultScore");
const resultRate = $("#resultRate");
const resultMessage = $("#resultMessage");
const reviewArea = $("#reviewArea");
const retryWrongBtn = $("#retryWrongBtn");
const retryModeBtn = $("#retryModeBtn");
const resultHomeBtn = $("#resultHomeBtn");

const bgmAudio = new Audio(AUDIO_FILES.bgm);
bgmAudio.loop = true;
bgmAudio.preload = "auto";
bgmAudio.volume = 0.42;

function makeAudioPool(src, size = 4, volume = 0.9) {
  const pool = Array.from({ length: size }, () => {
    const audio = new Audio(src);
    audio.preload = "auto";
    audio.volume = volume;
    return audio;
  });
  let index = 0;
  return () => {
    const audio = pool[index];
    index = (index + 1) % pool.length;
    try {
      audio.pause();
      audio.currentTime = 0;
      const promise = audio.play();
      if (promise) promise.catch(() => {});
    } catch (_) {}
  };
}

const playCorrect = makeAudioPool(AUDIO_FILES.correct, 4, 0.9);
const playWrong = makeAudioPool(AUDIO_FILES.wrong, 4, 0.9);
const playGo = makeAudioPool(AUDIO_FILES.go, 2, 0.95);

function normalizeRow(row) {
  const answer = Number(String(row.answer).replace(/[^1-4]/g, ""));
  if (![1, 2, 3, 4].includes(answer)) throw new Error(`第${row.id}問の正解番号が不正です。`);
  const choices = [row.choice1, row.choice2, row.choice3, row.choice4].map(v => String(v ?? "").trim());
  if (choices.some(v => !v)) throw new Error(`第${row.id}問の選択肢が不足しています。`);
  return {
    id: Number(row.id),
    source: String(row.source ?? "").trim(),
    question: String(row.question ?? "").trim(),
    choices,
    answer,
    explanation: String(row.explanation ?? "").trim(),
  };
}

function shuffle(values) {
  const array = [...values];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function stopTimer() {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
  timerTrack.classList.remove("warning");
}

function startTimer() {
  stopTimer();
  timerEndAt = Date.now() + QUESTION_TIME_SEC * 1000;
  timerBar.style.width = "100%";
  timerText.textContent = `${QUESTION_TIME_SEC.toFixed(1)}s`;

  timerId = window.setInterval(() => {
    const remaining = Math.max(0, timerEndAt - Date.now());
    const seconds = remaining / 1000;
    timerText.textContent = `${seconds.toFixed(1)}s`;
    timerBar.style.width = `${(remaining / (QUESTION_TIME_SEC * 1000)) * 100}%`;
    timerTrack.classList.toggle("warning", seconds <= WARN_AT_SEC);
    if (remaining <= 0) {
      stopTimer();
      handleTimeUp();
    }
  }, 100);
}

async function setBgm(on) {
  bgmOn = Boolean(on);
  bgmToggle.textContent = bgmOn ? "BGM: ON" : "BGM: OFF";
  bgmToggle.classList.toggle("active", bgmOn);
  if (!bgmOn) {
    bgmAudio.pause();
    return;
  }
  try {
    const promise = bgmAudio.play();
    if (promise) await promise;
  } catch (_) {
    bgmOn = false;
    bgmToggle.textContent = "BGM: OFF";
    bgmToggle.classList.remove("active");
  }
}

async function runCountdown() {
  countdownOverlay.hidden = false;
  for (const item of ["3", "2", "1", "GO"]) {
    countdownNumber.textContent = item;
    countdownNumber.classList.remove("pop");
    void countdownNumber.offsetWidth;
    countdownNumber.classList.add("pop");
    if (item === "GO") playGo();
    await new Promise(resolve => setTimeout(resolve, 760));
  }
  countdownOverlay.hidden = true;
}

function resetChoiceStyles() {
  choiceButtons.forEach(button => {
    button.disabled = false;
    button.classList.remove("correct", "wrong");
  });
}

function renderQuestion() {
  const q = order[currentIndex];
  locked = false;
  feedback.hidden = true;
  nextBtn.disabled = true;
  resetChoiceStyles();

  progress.textContent = `第${currentIndex + 1}問 / ${order.length}`;
  scoreEl.textContent = `正解 ${score}`;
  progressBar.style.width = `${((currentIndex + 1) / order.length) * 100}%`;
  originalQuestionNo.textContent = `教材 第${q.id}問`;

  if (q.source) {
    sourceEl.hidden = false;
    sourceEl.textContent = q.source;
  } else {
    sourceEl.hidden = true;
    sourceEl.textContent = "";
  }
  questionEl.textContent = q.question;

  choiceButtons.forEach((button, index) => {
    button.querySelector(".choice-text").textContent = q.choices[index];
  });
  startTimer();
}

function showFeedback({ isCorrect, isTimeUp }) {
  const q = order[currentIndex];
  feedback.hidden = false;
  feedback.classList.toggle("is-correct", isCorrect);
  feedback.classList.toggle("is-wrong", !isCorrect);
  feedbackTitle.textContent = isTimeUp ? "時間切れ" : (isCorrect ? "正解" : "不正解");
  correctAnswer.textContent = `正解：${MARKS[q.answer - 1]} ${q.choices[q.answer - 1]}`;
  explanationEl.textContent = q.explanation;
}

function finalizeAnswer(selectedIndex, isTimeUp = false) {
  if (locked) return;
  locked = true;
  stopTimer();

  const q = order[currentIndex];
  const correctIndex = q.answer - 1;
  const isCorrect = !isTimeUp && selectedIndex === correctIndex;

  choiceButtons.forEach(button => { button.disabled = true; });
  choiceButtons[correctIndex].classList.add("correct");
  if (!isTimeUp && !isCorrect && selectedIndex >= 0) choiceButtons[selectedIndex].classList.add("wrong");

  if (isCorrect) {
    score++;
    playCorrect();
    quizPanel.classList.remove("shake");
    quizPanel.classList.add("flash");
    setTimeout(() => quizPanel.classList.remove("flash"), 350);
  } else {
    playWrong();
    quizPanel.classList.remove("flash");
    quizPanel.classList.add("shake");
    setTimeout(() => quizPanel.classList.remove("shake"), 350);
  }

  history.push({ q, selectedIndex, correctIndex, isCorrect, isTimeUp });
  scoreEl.textContent = `正解 ${score}`;
  showFeedback({ isCorrect, isTimeUp });
  nextBtn.disabled = false;
  nextBtn.textContent = currentIndex === order.length - 1 ? "結果を見る" : "次の問題へ";
  feedback.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function handleTimeUp() {
  finalizeAnswer(-1, true);
}

function getResultMessage(rate) {
  if (rate >= 90) return "非常によく定着しています。この精度を維持しましょう。";
  if (rate >= 75) return "概ね良好です。誤答した助動詞だけをもう一度確認しましょう。";
  if (rate >= 50) return "基本事項はつかめています。接続と意味の識別を重点的に復習しましょう。";
  return "まずは接続規則と活用表から整理すると、正答率が大きく伸びます。";
}

function createReviewItem(item) {
  const article = document.createElement("article");
  article.className = "review-item";

  const heading = document.createElement("h3");
  heading.textContent = `教材 第${item.q.id}問`;
  article.appendChild(heading);

  if (item.q.source) {
    const source = document.createElement("p");
    source.className = "review-source";
    source.textContent = item.q.source;
    article.appendChild(source);
  }

  const question = document.createElement("p");
  question.textContent = item.q.question;
  article.appendChild(question);

  const userAnswer = document.createElement("p");
  userAnswer.className = "review-answer wrong-text";
  userAnswer.textContent = item.isTimeUp
    ? "あなたの解答：時間切れ"
    : `あなたの解答：${MARKS[item.selectedIndex]} ${item.q.choices[item.selectedIndex]}`;
  article.appendChild(userAnswer);

  const correct = document.createElement("p");
  correct.className = "review-answer correct-text";
  correct.textContent = `正解：${MARKS[item.correctIndex]} ${item.q.choices[item.correctIndex]}`;
  article.appendChild(correct);

  const explanation = document.createElement("p");
  explanation.className = "review-explanation";
  explanation.textContent = item.q.explanation;
  article.appendChild(explanation);
  return article;
}

function showResult() {
  stopTimer();
  const total = order.length;
  const rate = total ? Math.round((score / total) * 100) : 0;
  const wrongItems = history.filter(item => !item.isCorrect);

  resultScore.textContent = `${score} / ${total}`;
  resultRate.textContent = `正答率 ${rate}%`;
  resultMessage.textContent = getResultMessage(rate);
  reviewArea.replaceChildren();

  if (wrongItems.length) {
    const title = document.createElement("h3");
    title.className = "review-title";
    title.textContent = `誤答・時間切れの確認（${wrongItems.length}問）`;
    reviewArea.appendChild(title);
    wrongItems.forEach(item => reviewArea.appendChild(createReviewItem(item)));
  } else {
    const perfect = document.createElement("p");
    perfect.className = "perfect-message";
    perfect.textContent = "全問正解です。誤答はありません。";
    reviewArea.appendChild(perfect);
  }

  retryWrongBtn.disabled = wrongItems.length === 0;
  resultOverlay.hidden = false;
}

async function startSession(mode, suppliedQuestions = null) {
  stopTimer();
  resultOverlay.hidden = true;
  startScreen.hidden = true;
  app.hidden = false;
  currentMode = mode;
  currentIndex = 0;
  score = 0;
  history = [];

  if (suppliedQuestions) {
    order = [...suppliedQuestions];
    modeLabel.textContent = `誤答復習（${order.length}問）`;
  } else if (mode === "all") {
    order = [...questions].sort((a, b) => a.id - b.id);
    modeLabel.textContent = "全75問演習";
  } else {
    order = shuffle(questions).slice(0, Math.min(RANDOM_QUESTION_COUNT, questions.length));
    modeLabel.textContent = "ランダム10問";
  }

  await setBgm(true);
  await runCountdown();
  renderQuestion();
}

function returnHome() {
  stopTimer();
  resultOverlay.hidden = true;
  app.hidden = true;
  startScreen.hidden = false;
  bgmAudio.pause();
  bgmAudio.currentTime = 0;
  bgmOn = true;
  bgmToggle.textContent = "BGM: ON";
  bgmToggle.classList.add("active");
}

choiceButtons.forEach((button, index) => {
  button.addEventListener("click", () => finalizeAnswer(index, false));
});

nextBtn.addEventListener("click", () => {
  if (!locked) return;
  if (currentIndex >= order.length - 1) {
    showResult();
  } else {
    currentIndex++;
    renderQuestion();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
});

randomModeBtn.addEventListener("click", () => startSession("random"));
allModeBtn.addEventListener("click", () => startSession("all"));
restartBtn.addEventListener("click", returnHome);
resultHomeBtn.addEventListener("click", returnHome);
bgmToggle.addEventListener("click", () => setBgm(!bgmOn));

retryModeBtn.addEventListener("click", () => startSession(currentMode));
retryWrongBtn.addEventListener("click", () => {
  const wrongQuestions = history.filter(item => !item.isCorrect).map(item => item.q);
  if (wrongQuestions.length) startSession(currentMode, wrongQuestions);
});

async function initialize() {
  try {
    const rows = await window.CSVUtil.load("./questions.csv");
    questions = rows.map(normalizeRow).sort((a, b) => a.id - b.id);
    if (questions.length !== 75) throw new Error(`問題数が75題ではありません（現在 ${questions.length}題）。`);
    randomModeBtn.disabled = false;
    allModeBtn.disabled = false;
  } catch (error) {
    console.error(error);
    randomModeBtn.disabled = true;
    allModeBtn.disabled = true;
    document.querySelector(".start-note").textContent =
      "問題データを読み込めませんでした。GitHub PagesまたはローカルWebサーバー上で開いてください。";
  }
}

randomModeBtn.disabled = true;
allModeBtn.disabled = true;
initialize();
