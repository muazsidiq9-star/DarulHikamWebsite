console.log("Payment JS loaded");

document.addEventListener('DOMContentLoaded', () => {

  /* ================= HAMBURGER MENU ================= */
  const hamburger = document.querySelector('.hamburger');
  const navLinks = document.getElementById('navLinks');

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => navLinks.classList.toggle('show'));
    document.addEventListener('click', e => {
      if (!navLinks.contains(e.target) && !hamburger.contains(e.target)) {
        navLinks.classList.remove('show');
      }
    });
  }

  /* ================= SELAR PAYMENT ================= */
  const selarBtn = document.querySelector('.selar-btn');
  if (selarBtn) {
    selarBtn.addEventListener('click', () => {
      window.open('https://selar.com/al-bayan-institute', '_blank');
    });
  }

  /* ================= COPY TO CLIPBOARD ================= */
  window.copyText = function (text) {
    navigator.clipboard.writeText(text).then(() => {
      const toast = document.getElementById('copy-toast');
      if (!toast) return;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2000);
    });
  };

  /* ================= SUPABASE ================= */
  const SUPABASE_URL = "https://ymxuwahcogzbbohdbpgg.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_oAh_xPW62nDFS9JGh5CUcA_mnHC4t3w";
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  /* ================= PAYMENT FORM ================= */
  const paymentForm = document.querySelector('.payment-form');
  const successMsg = document.querySelector('.success-msg');
  const errorMsg = document.querySelector('.error-msg');
  const submitBtn = document.querySelector('.submit-btn');

  if (!paymentForm) return;

  successMsg.style.display = 'none';
  errorMsg.style.display = 'none';

  /* ================= CURRENT STUDENT ================= */
  const currentStudent = JSON.parse(sessionStorage.getItem('currentStudent'));
  console.log("Current student from session:", currentStudent);

  // Auto-fill form if logged in
if (currentStudent) {
  document.getElementById('student-name').value = currentStudent.fullname || '';
  document.getElementById('student-email').value = currentStudent.email || '';

  // Auto-fill level dropdown
  if (currentStudent.level) {
    const levelSelect = document.getElementById('level-arabic');
    for (let option of levelSelect.options) {
      if (option.text === currentStudent.level) {
        option.selected = true;
        break;
      }
    }
  }
}

  paymentForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fullname = document.getElementById('student-name').value.trim();
    const email = document.getElementById('student-email').value.trim();
    const level = document.getElementById('level-arabic').value;
    const method = document.getElementById('payment-method').value.trim();
    const amount = document.getElementById('amount').value;
    const date = document.getElementById("payment-date")?.value || null;
    const month = document.getElementById('month').value;

    if (!level || !method || !amount || !month) {
      errorMsg.textContent = t('Please fill all required fields correctly.');
      errorMsg.style.display = 'block';
      successMsg.style.display = 'none';
      return;
    }

    submitBtn.disabled = true;
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = t('Processing... ⏳');

    try {
      // Determine if logged-in student or guest
      const insertData = {
        matric_number: currentStudent?.matric_number || null,
        level_arabic: level,
        payment_method: method,
        amount: Number(amount),
        created_at: date,
        month: month,
        status: "pending"
      };

      // Only insert payer_name/email for guests
      if (!currentStudent) {
        insertData.payer_name = fullname || null;
        insertData.payer_email = email || null;
      }

      const { error } = await supabase.from("payments").insert([insertData]);
      if (error) throw error;

      paymentForm.reset();

      // Refill name/email for logged-in students
      if (currentStudent) {
        document.getElementById('student-name').value = currentStudent.fullname || '';
        document.getElementById('student-email').value = currentStudent.email || '';
      }

      successMsg.textContent = t('Payment submitted successfully. We will confirm shortly.');
      successMsg.style.display = 'block';
      errorMsg.style.display = 'none';
    } catch (err) {
      console.error('Payment submission error:', err);
      errorMsg.textContent = t('Something went wrong. Please try again.');
      errorMsg.style.display = 'block';
      successMsg.style.display = 'none';
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  });

});
