// ================= SUPABASE CLIENT =================
const supabaseUrl = "https://ymxuwahcogzbbohdbpgg.supabase.co";
const supabaseKey = "sb_publishable_oAh_xPW62nDFS9JGh5CUcA_mnHC4t3w";
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);
console.log('Supabase loaded');

// ================= SESSION CHECK =================
const role = sessionStorage.getItem("role");
const matricNumber = sessionStorage.getItem("matric");
const studentData = sessionStorage.getItem("currentStudent");

if (role !== "student" || !matricNumber || !studentData) {
  alert("Session expired. Please log in again.");
  window.location.href = "login.html";
  throw new Error("Invalid session");
}

const currentStudent = JSON.parse(studentData);

// ================= DOM ELEMENTS =================
const examTitle = document.getElementById('examTitle');
const examMessage = document.getElementById('examMessage');
const questionsContainer = document.getElementById('questionsContainer');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const reviewBtn = document.getElementById('reviewBtn');
const reviewModal = document.getElementById('reviewModal');
const reviewList = document.getElementById('reviewList');
const finalSubmitBtn = document.getElementById('finalSubmitBtn');
const progressBar = document.getElementById('progressBar');
const countdownBar = document.getElementById('countdownBar');
const timeDisplay = document.getElementById('time');
const timeWarning = document.getElementById('timeWarning');

// ================= STATE =================
let assessmentId = null;
let questions = [];
let currentIndex = 0;
let studentAnswers = {};
let durationMinutes = 0;
let timeRemaining = 0;
let timerInterval;
let warningShown = false;
let testEnded = false;

// ================= SHUFFLE UTIL =================
function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ================= CHECK FEES =================
async function checkFees() {
    const monthNames = [
      "January","February","March","April","May","June",
      "July","August","September","October","November","December"
    ];
    const currentMonthName = monthNames[new Date().getMonth()]; // e.g., "February"

    const { data, error } = await supabaseClient
      .from("payments")
      .select("id")
      .eq("matric_number", matricNumber)
      .eq("month", currentMonthName)
      .eq("status", "paid")
      .eq("deleted", false)
      .limit(1);

    if (error) console.error("Check Fees Error:", error);

    if (!data || data.length === 0) {
        examTitle.textContent = "Access Denied";
        examMessage.textContent = "You have not completed payment for this month.";
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        reviewBtn.disabled = true;
        finalSubmitBtn.disabled = true;
        return false;
    }

    return true;
}

async function loadActiveAssessment() {
    const hasPaid = await checkFees();
    if (!hasPaid) return;

    const now = new Date().toISOString();

    const studentLevel = currentStudent.level;

let { data, error } = await supabaseClient
    .from('assessments')
    .select('*')
    .eq('is_active', true)
    .eq('status', 'active')
    .eq('level_arabic', studentLevel)
    .limit(1);
console.log(currentStudent);
if (error) {
    console.error("Load assessment error:", error);
}

if (!data || data.length === 0) {
    examTitle.textContent = "No Active Test / Exam";
    examMessage.textContent = "Please check back later.";
    return;
}

    const assessment = data[0];
    assessmentId = assessment.id;

    examTitle.textContent = assessment.title;
    examMessage.textContent = assessment.description || '';
    durationMinutes = assessment.duration_minutes || 30;

    // Only start timer if student hasn't already submitted
const { count: finalCount } = await supabaseClient
    .from('student_answers')
    .select('id', { count: 'exact', head: true })
    .eq('matric_number', matricNumber)
    .eq('assessment_id', assessmentId)
    .eq('is_final', true);

if (finalCount === 0) {
    const savedState = localStorage.getItem(
        `exam_state_${assessmentId}_${matricNumber}`
    );

    if (savedState) {
        const state = JSON.parse(savedState);
        timeRemaining = state.timeRemaining || durationMinutes * 60;
    } else {
        timeRemaining = durationMinutes * 60;
    }

    startTimer();
} else {
    timeRemaining = 0;
    timeDisplay.textContent = '00:00';
    countdownBar.style.width = '0%';
}
}

// ================= LOAD QUESTIONS =================
async function loadQuestions() {
    if (!assessmentId) return;
    
    const { count, error: checkError } = await supabaseClient
    .from('student_answers')
    .select('id', { count: 'exact', head: true })
    .eq('matric_number', matricNumber)
    .eq('assessment_id', assessmentId)
    .eq('is_final', true);

if (checkError) console.error('Check submission error:', checkError);

if (count > 0) {
    examMessage.textContent =
        'You have already attempted this test/exam. Wait for the next schedule.';

    prevBtn.disabled = true;
    nextBtn.disabled = true;
    reviewBtn.disabled = true;
    finalSubmitBtn.disabled = true;

    return;
}

    // 1. Fetch questions FIRST
    const { data, error } = await supabaseClient
        .from('questions')
        .select('*')
        .eq('assessment_id', assessmentId)
        .neq('deleted', true)
        .order('question_order', { ascending: true });

    if (error || !data || data.length === 0) {
        examMessage.textContent = "No questions available.";
        return;
    }

const { count: draftCount } = await supabaseClient
    .from('student_answers')
    .select('id', { count: 'exact', head: true })
    .eq('matric_number', matricNumber)
    .eq('assessment_id', assessmentId)
    .eq('is_final', false);

    // ================= RESTORE EXAM STATE =================
const savedState = localStorage.getItem(
    `exam_state_${assessmentId}_${matricNumber}`
);

let restored = false;

if (savedState && draftCount > 0) {
    const state = JSON.parse(savedState);

    currentIndex = state.currentIndex || 0;
    studentAnswers = state.studentAnswers || {};
    timeRemaining = state.timeRemaining || durationMinutes * 60;

    const orderMap = new Map();
    data.forEach(q => orderMap.set(q.id, q));

    questions = state.questionsOrder
        ? state.questionsOrder.map(id => orderMap.get(id)).filter(Boolean)
        : data;

    restored = true;
} else {
    // FIRST TIME ONLY → shuffle once
    questions = shuffleArray(data).map(q => {
        if (q.question_type === "mcq" && Array.isArray(q.options)) {
            q.options = shuffleArray(q.options);
        }
        return q;
    });

    currentIndex = 0;
    studentAnswers = {};
}

    // 5. Render + start saving
    renderQuestionWithProgress();
    saveExamState();

    reviewBtn.disabled = false;
    finalSubmitBtn.disabled = false;
}


// ================= RENDER QUESTIONS =================
function renderQuestion() {
    const q = questions[currentIndex];
    questionsContainer.innerHTML = `<p>${currentIndex + 1}. ${q.question_text}</p>`;

    // MCQ options
    if (q.question_type === 'mcq') {
        (q.options || []).forEach(opt => {
            const label = document.createElement('label');
            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'answer';
            input.value = opt;
            if (studentAnswers[q.id] === opt) input.checked = true;

            input.addEventListener('change', async () => {
                studentAnswers[q.id] = input.value;
                const { error } = await supabaseClient.from('student_answers').upsert({
                    matric_number: matricNumber,
                    assessment_id: assessmentId,
                    question_id: q.id,
                    answer_text: input.value,
                    is_final: false
                }, { onConflict: ['matric_number', 'question_id'] });

                if (error) console.error('Auto-save error:', error);
                saveExamState();
            });

            label.appendChild(input);
            label.insertAdjacentText('beforeend', ` ${opt}`);
            questionsContainer.appendChild(label);
        });
    } else {
        // Free text
        const textarea = document.createElement('textarea');
        textarea.value = studentAnswers[q.id] || '';
        textarea.placeholder = 'Type your answer here...';
        textarea.rows = 4;
        textarea.style.width = '100%';
        questionsContainer.appendChild(textarea);

        let typingTimer;
        const typingDelay = 800;
        textarea.addEventListener('input', () => {
            clearTimeout(typingTimer);
            typingTimer = setTimeout(async () => {
                const answer = textarea.value.trim();
                studentAnswers[q.id] = answer;

                const { error } = await supabaseClient.from('student_answers').upsert({
                    matric_number: matricNumber,
                    assessment_id: assessmentId,
                    question_id: q.id,
                    answer_text: answer,
                    is_final: false
                }, { onConflict: ['matric_number', 'question_id'] });

                if (error) console.error('Auto-save error:', error);
                saveExamState();
            }, typingDelay);
        });
    }
}

// ================= NAVIGATION =================
function renderQuestionWithProgress() {
    renderQuestion();
    updateProgressBar();
    prevBtn.disabled = currentIndex === 0;
    nextBtn.disabled = currentIndex === questions.length - 1;
}

function updateProgressBar() {
    if (!questions || questions.length === 0) return;
    const percent = ((currentIndex + 1) / questions.length) * 100;
    progressBar.style.width = `${percent}%`;
}

prevBtn.addEventListener('click', async () => {
    await saveAnswer();
    if (currentIndex > 0) currentIndex--;
    renderQuestionWithProgress();
    saveExamState();
});

nextBtn.addEventListener('click', async () => {
    await saveAnswer();
    if (currentIndex < questions.length - 1) currentIndex++;
    renderQuestionWithProgress();
    saveExamState();
});

// ================= SAVE ANSWER =================
async function saveAnswer() {
    const q = questions[currentIndex];
    if (!q) return;

    let answer = '';
    if (q.question_type === 'mcq') {
        const selected = document.querySelector('input[name="answer"]:checked');
        answer = selected ? selected.value : '';
    } else {
        const textarea = document.querySelector('textarea');
        answer = textarea ? textarea.value.trim() : '';
    }

    studentAnswers[q.id] = answer;

    const { error } = await supabaseClient
  .from('student_answers')
  .upsert(
    {
      matric_number: matricNumber,
      assessment_id: assessmentId,
      question_id: q.id,
      answer_text: answer,
      is_final: false,
      updated_at: new Date().toISOString()
    },
    {
      onConflict: 'matric_number,assessment_id,question_id'
    }
  );

if (error) {
  console.error('Error saving answer:', error);
}
}

function saveExamState() {
    const state = {
        assessmentId,
        currentIndex,
        timeRemaining,
        studentAnswers,
        questionsOrder: questions.map(q => q.id)
    };

    localStorage.setItem(
        `exam_state_${assessmentId}_${matricNumber}`,
        JSON.stringify(state)
    );
}

// ================= TIMER =================
function startTimer() {
    if (timerInterval) clearInterval(timerInterval);

    // Initialize countdown bar
    if (countdownBar) {
        countdownBar.classList.remove(
            'countdown-warning-mid',
            'countdown-warning-critical'
        );
        countdownBar.classList.add('countdown-safe'); // 🟢 safe at start
    }

    // Hide 2-minute warning at start
    if (timeWarning) {
        timeWarning.classList.add('hidden');
    }

    timerInterval = setInterval(() => {
        if (testEnded) {
            clearInterval(timerInterval);
            return;
        }

        if (timeRemaining <= 0) {
            clearInterval(timerInterval);
            alert('Time is up! Your answers will be submitted automatically.');
            finalSubmit();
            return;
        }

        // Update timer display
        const minutes = Math.floor(timeRemaining / 60);
        const seconds = timeRemaining % 60;
        timeDisplay.textContent = `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;

        // Update countdown bar width
        if (countdownBar) {
            const percent = (timeRemaining / (durationMinutes * 60)) * 100;
            countdownBar.style.width = `${percent}%`;

            // 🔄 Reset classes before assigning new color
            countdownBar.classList.remove(
                'countdown-safe',
                'countdown-warning-mid',
                'countdown-warning-critical'
            );

            // 🟢 Safe: more than 5 minutes
            if (timeRemaining > 300) {
                countdownBar.classList.add('countdown-safe');
            }
            // 🟠 Mid warning: 5 → 2 minutes
            else if (timeRemaining > 120) {
                countdownBar.classList.add('countdown-warning-mid');
            }
            // 🔴 Critical: 2 minutes or less
            else {
                countdownBar.classList.add('countdown-warning-critical');
            }
        }

        // 🔔 Show 2-minute HTML warning only once
        if (!warningShown && timeRemaining <= 120) {
            warningShown = true;
            if (timeWarning) {
                timeWarning.classList.remove('hidden');
            }
        }

        timeRemaining--;
    }, 1000);
}

// ================= REVIEW MODAL =================
reviewBtn.addEventListener('click', async () => {
    await saveAnswer(); // save latest

    reviewList.innerHTML = '';
    questions.forEach((q, idx) => {
    const li = document.createElement('li');
    const answerText = studentAnswers[q.id] || '[❌ Not answered]';

    li.dataset.index = idx; // 👈 key line
    li.style.cursor = 'pointer';

    li.innerHTML = `
      <div class="question">${idx + 1}. ${q.question_text}</div>
      <div class="answer">${answerText}</div>
    `;

    li.addEventListener('click', async () => {
        await saveAnswer();               // save current question safely
        currentIndex = idx;               // jump to clicked question
        renderQuestionWithProgress();     // reuse existing renderer
        reviewModal.style.display = 'none';
    });

    reviewList.appendChild(li);
});

    reviewModal.style.display = 'flex';
});

window.addEventListener('click', e => {
    if (e.target === reviewModal) reviewModal.style.display = 'none';
});

// ================= FINAL SUBMIT =================
async function finalSubmit() {
    if (testEnded) return;

    if (!finalSubmitBtn) return;

    // Show loading
    const originalText = finalSubmitBtn.textContent;
    finalSubmitBtn.textContent = 'Loading...';
    finalSubmitBtn.disabled = true;

    try {
        await saveAnswer();

        // 🚫 Block final submit if unanswered questions exist
const unanswered = questions.some(q => {
    const ans = studentAnswers[q.id];
    return !ans || ans.trim() === '';
});

if (unanswered) {

    const confirmSubmit = confirm(
        "You still have unanswered questions.\n\nPress OK to submit anyway or Cancel to continue reviewing."
    );

    if (!confirmSubmit) {
        reviewBtn.click();

        finalSubmitBtn.textContent = originalText;
        finalSubmitBtn.disabled = false;
        return;
    }
}

        for (let qid in studentAnswers) {
            await supabaseClient.from('student_answers').update({ is_final: true })
                .eq('matric_number', matricNumber)
                .eq('question_id', qid);
        }

        const { data, error } = await supabaseClient.rpc('grade_student_assessment', {
            p_student_matric: matricNumber,
            p_assessment_id: assessmentId
        });

        if (error) {
            alert('Error grading exam. Check console.');
            console.error(error);
            return;
        }

        testEnded = true;

if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
}

// ✅ CLEAR SAVED EXAM STATE
localStorage.removeItem(
    `exam_state_${assessmentId}_${matricNumber}`
);

reviewModal.style.display = 'none';
endTestSession();

    } finally {
        // Restore button
        finalSubmitBtn.textContent = originalText;
        finalSubmitBtn.disabled = false;
    }
}

finalSubmitBtn.addEventListener('click', finalSubmit);

function endTestSession() {
    // Stop timer
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    // Disable controls
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    reviewBtn.disabled = true;
    finalSubmitBtn.disabled = true;

    // Show completion modal
    const completionModal = document.getElementById('completionModal');
    completionModal.style.display = 'flex';
}

// ================= INIT =================
document.addEventListener('DOMContentLoaded', async () => {
    await loadActiveAssessment();
    await loadQuestions();
});

document.getElementById('goDashboardBtn').onclick = () => {
    window.location.href = "students-dashboard.html";
};

document.getElementById('closeReviewModal').addEventListener('click', () => {
    reviewModal.style.display = 'none';
});

document.getElementById('backToExamBtn').addEventListener('click', () => {
    reviewModal.style.display = 'none';
});
document.getElementById('logoutBtn').onclick = () => {
    sessionStorage.clear();
    window.location.href = "login.html";
};