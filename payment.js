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
  const SUPABASE_KEY = "sb_publishable_oAh_xPW62nDFS9JGh5CUcA_mnHC4t3w";
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  /* ================= CURRENT STUDENT (SOURCE OF TRUTH) ================= */
  function getCurrentStudent() {
    try {
      return JSON.parse(sessionStorage.getItem('currentStudent'));
    } catch (e) {
      return null;
    }
  }

  const currentStudent = getCurrentStudent();
  console.log("Current student:", currentStudent);

  let detectedStudent = null;

  /* ================= LEVEL & PLAN MAPS ================= */

  // Maps any stored variant (English or Arabic) → the exact option value in the <select>
  const LEVEL_MAP = {
    // English (case-insensitive handled below)
    'preliminary'  : 'Preliminary',
    'beginner'     : 'Beginner',
    'intermediate' : 'Intermediate',
    'advanced'     : 'Advanced',
    // Arabic variants — add more here as you discover them in Supabase
    'تمهيدي'       : 'Preliminary',
    'مبتدئ'        : 'Beginner',
    'مبتدئء'       : 'Beginner',
    'مبتديء'       : 'Beginner',
    'متوسط'        : 'Intermediate',
    'متقدم'        : 'Advanced',
  };

  // Maps any stored plan variant → the exact option value in the <select>
  const PLAN_MAP = {
    // English
    'general'  : 'general',
    'private'  : 'private',
    'premium'  : 'private',   // in case DB stores "Premium" instead of "private"
    // Arabic variants
    'عام'      : 'general',
    'خاص'      : 'private',
    'مميز'     : 'private',
  };

  /* ================= HELPERS ================= */

  // Same list used in register.js — keep these in sync if either changes
  const WEST_AFRICA_COUNTRIES = [
    "nigeria", "ghana", "benin", "togo", "niger", "cameroon",
    "senegal", "mali", "burkina faso", "guinea", "guinea-bissau",
    "sierra leone", "liberia", "ivory coast", "gambia",
    "cape verde", "mauritania"
  ];

  function isWestAfrica(countryRaw) {
    if (!countryRaw) return null; // unknown — caller decides fallback behaviour
    return WEST_AFRICA_COUNTRIES.includes(countryRaw.trim().toLowerCase());
  }

  // Shows/hides local bank cards vs international cards based on country.
  // Flutterwave card and the manual receipt form always stay visible —
  // they work for either local or international payments.
  function applyCountrySectionVisibility(countryRaw) {
    const localCards = document.querySelectorAll('.local-card');
    const intlCards  = document.querySelectorAll('.intl-card');
    const westAfrica = isWestAfrica(countryRaw);

    if (westAfrica === null) {
      // No country known yet — show everything so nothing looks broken
      // before the student's email/session resolves their country.
      localCards.forEach(el => el.style.display = '');
      intlCards.forEach(el => el.style.display = '');
      return;
    }

    localCards.forEach(el => el.style.display = westAfrica ? '' : 'none');
    intlCards.forEach(el => el.style.display = westAfrica ? 'none' : '');
  }

  function resolveFromMap(map, rawValue) {
    if (!rawValue) return null;
    const trimmed = rawValue.trim();
    // Try lowercase first (handles English case differences)
    return map[trimmed.toLowerCase()] || map[trimmed] || null;
  }

  function setLevel(value) {
    const resolved = resolveFromMap(LEVEL_MAP, value);
    console.log("setLevel raw:", value, "→ resolved:", resolved);
    if (!resolved) return;

    const select = document.getElementById('level-arabic');
    for (const option of select.options) {
      if (option.value === resolved) {
        option.selected = true;
        break;
      }
    }
  }

  function setPlan(value) {
    const resolved = resolveFromMap(PLAN_MAP, value);
    console.log("setPlan raw:", value, "→ resolved:", resolved);
    if (!resolved) return;

    const select = document.getElementById('plan-type');
    for (const option of select.options) {
      if (option.value === resolved) {
        option.selected = true;
        break;
      }
    }
  }

  function showError(message) {
    errorMsg.textContent = message;
    errorMsg.style.display = 'block';
    successMsg.textContent = '';
    successMsg.style.display = 'none';
  }

  function showSuccess(message) {
    successMsg.textContent = message;
    successMsg.style.display = 'block';
    errorMsg.textContent = '';
    errorMsg.style.display = 'none';
  }

  const paymentForm = document.querySelector('.payment-form');
  const successMsg = document.querySelector('.success-msg');
  const errorMsg = document.querySelector('.error-msg');
  const submitBtn = document.querySelector('.submit-btn');

  if (!paymentForm) return;

  successMsg.style.display = 'none';
  errorMsg.style.display = 'none';

  /* ================= AUTO FILL FROM SESSION ================= */
  if (currentStudent) {
    document.getElementById('student-name').value  = currentStudent.fullname || '';
    document.getElementById('student-email').value = currentStudent.email    || '';
    document.getElementById('country').value       = currentStudent.country  || '';

    setPlan(currentStudent.plan_type);
    setLevel(currentStudent.level);
  }

  applyCountrySectionVisibility(currentStudent?.country);

  /* ================= FLUTTERWAVE ================= */
  const FLUTTERWAVE_PUBLIC_KEY = "FLWPUBK-34b2c1c3c94fc67ab94089b5ec2f28a8-X";
  const VERIFY_PAYMENT_ENDPOINT = "https://ymxuwahcogzbbohdbpgg.supabase.co/functions/v1/verify-flutterwave-payment";

  const flutterwaveAmountEl = document.getElementById('flutterwaveAmount');
  const flutterwavePayBtn   = document.getElementById('flutterwavePayBtn');

  // Resolves amount/currency due, preferring live DB record over session data
  function getAmountDue() {
    const source = detectedStudent || currentStudent;
    if (!source) return { amount: null, currency: null };
    return {
      amount: source.amount_due ?? null,
      currency: source.currency_due ?? null
    };
  }

  function refreshFlutterwaveAmount() {
    const { amount, currency } = getAmountDue();
    if (!amount || !currency) {
      flutterwaveAmountEl.textContent = t('Enter your email above to see your amount due.');
      flutterwavePayBtn.disabled = true;
      return;
    }
    const symbol = currency === 'NGN' ? '₦' : currency === 'USD' ? '$' : currency + ' ';
    flutterwaveAmountEl.textContent = `${symbol}${Number(amount).toLocaleString()} ${currency}`;
    flutterwavePayBtn.disabled = false;
  }

  refreshFlutterwaveAmount();

  flutterwavePayBtn?.addEventListener('click', () => {
  console.log("Flutterwave button clicked");
  
    const student = detectedStudent || currentStudent;
    const { amount, currency } = getAmountDue();

    if (!student || !student.email || !amount || !currency) {
      showError(t('We could not find your amount due. Please enter your email above first.'));
      return;
    }

    if (typeof FlutterwaveCheckout !== 'function') {
      showError(t('Payment system failed to load. Please refresh and try again.'));
      return;
    }

    const txRef = `daralulum-${student.matric_number || 'nomatric'}-${Date.now()}`;

    FlutterwaveCheckout({
      public_key: FLUTTERWAVE_PUBLIC_KEY,
      tx_ref: txRef,
      amount: Number(amount),
      currency: currency,
      payment_options: "card, banktransfer, ussd",
      customer: {
        email: student.email,
        name: student.fullname || ''
      },
      customizations: {
        title: "Dar Al-Ulum Wal Hikam Institute",
        description: `${student.plan_type || 'Course'} Registration Payment`,
        logo: "logo.png"
      },
      callback: async (response) => {
        // NEVER trust this client-side response alone — always verify server-side
        await verifyAndRecordPayment(response.transaction_id, txRef, student, amount, currency);
      },
      onclose: () => {
        console.log("Flutterwave checkout closed by user.");
      }
    });
  });

  async function verifyAndRecordPayment(transactionId, txRef, student, expectedAmount, expectedCurrency) {
    flutterwavePayBtn.disabled = true;
    const originalText = flutterwavePayBtn.innerHTML;
    flutterwavePayBtn.innerHTML = t('Verifying payment... ⏳');

    try {
      const res = await fetch(VERIFY_PAYMENT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_id: transactionId,
          tx_ref: txRef,
          matric_number: student.matric_number || null,
          payer_name: student.fullname || '',
          payer_email: student.email,
          expected_amount: expectedAmount,
          expected_currency: expectedCurrency,
          plan_type: student.plan_type || null,
          country: student.country || null
        })
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.message || t('Payment verification failed.'));
      }

      // Redirect to the dedicated result page only after OUR OWN server-side
      // verification has already succeeded — this doesn't change the security
      // model at all, it's just a nicer landing screen than an inline toast.
      const successParams = new URLSearchParams({
        status: "success",
        amount: expectedAmount,
        currency: expectedCurrency,
        tx: txRef
      });
      window.location.href = `payment-result.html?${successParams.toString()}`;

    } catch (err) {
      console.error("Payment verification error:", err);
      const failParams = new URLSearchParams({
        status: "failed",
        tx: txRef,
        reason: err.message || t('Payment verification failed.')
      });
      window.location.href = `payment-result.html?${failParams.toString()}`;
    } finally {
      flutterwavePayBtn.disabled = false;
      flutterwavePayBtn.innerHTML = originalText;
    }
  }

  /* ================= EMAIL LOOKUP ================= */
  const emailInput = document.getElementById('student-email');

  // Shared lookup used both by manual email blur AND the automatic
  // on-load re-check below, so both paths stay in sync with each other.
  async function lookupStudentByEmail(email, { silent = false } = {}) {
    if (!email) return;

    try {
      const { data, error } = await supabase
        .from("students")
        .select("*")
        .eq("email", email)
        .maybeSingle();

      if (error) throw error;
      if (!data) return;

      detectedStudent = data;

      console.log("Student found — plan_type:", data.plan_type, "| level_arabic:", data.level_arabic);

      document.getElementById('student-name').value = data.fullname || '';
      document.getElementById('country').value      = data.country  || '';

      setPlan(data.plan_type);
      setLevel(data.level_arabic);
      refreshFlutterwaveAmount();
      applyCountrySectionVisibility(data.country);

      // Silent mode is for the automatic background re-check on page load —
      // we don't want a "Student record found" toast popping up for
      // something the student didn't initiate themselves.
      if (!silent) {
        showSuccess(t('Student record found automatically.'));
      }

    } catch (err) {
      console.error("Student lookup failed:", err);
    }
  }

  emailInput?.addEventListener('blur', async () => {
    const email = emailInput.value.trim().toLowerCase();
    await lookupStudentByEmail(email);
  });

  // ================= AUTO-REFRESH FOR STALE SESSION DATA =================
  // If sessionStorage.currentStudent exists but is missing amount_due /
  // currency_due (e.g. an older registration made before these columns
  // existed, later corrected only in the database), the Flutterwave
  // button would otherwise stay disabled forever — the student never
  // manually clicks in/out of the email field since it's auto-filled by
  // JS, not typed. So: proactively re-fetch from the database once on
  // load whenever that gap is detected.
  if (currentStudent?.email && (!currentStudent.amount_due || !currentStudent.currency_due)) {
    console.log("Session data missing amount_due/currency_due — re-checking database…");
    lookupStudentByEmail(currentStudent.email.trim().toLowerCase(), { silent: true });
  }

  /* ================= PAYMENT SUBMIT ================= */
  paymentForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fullname   = document.getElementById('student-name').value.trim();
    const email      = document.getElementById('student-email').value.trim();
    const country    = document.getElementById('country')?.value || null;
    const plan_type  = document.getElementById('plan-type')?.value || null;
    const level      = document.getElementById('level-arabic').value;
    const method     = document.getElementById('payment-method').value.trim();
    const amount     = document.getElementById('amount').value;
    const currency   = document.getElementById("currency").value;
    const date       = document.getElementById("payment-date")?.value || null;
    const month      = document.getElementById('month').value;
    const receiptFile = document.getElementById('receipt')?.files[0] || null;

    if (!fullname || !email || !level || !method || !amount || !month) {
      showError(t('Please fill all required fields correctly.'));
      return;
    }

    submitBtn.disabled = true;
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = t('Processing... ⏳');

    try {

      let receipt_url = null;

      if (receiptFile) {
        const fileExt = receiptFile.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.floor(Math.random() * 100000)}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('payment_receipts')
          .upload(fileName, receiptFile);

        if (uploadError) throw uploadError;

        receipt_url = supabase.storage
          .from('payment_receipts')
          .getPublicUrl(fileName).data.publicUrl;
      }

      const insertData = {
        matric_number  : (detectedStudent || currentStudent)?.matric_number || null,
        payer_name     : fullname,
        payer_email    : email,
        country,
        plan_type,
        level_arabic   : level,
        payment_method : method,
        amount         : Number(amount),
        currency,
        payment_date   : date,
        month,
        receipt_url,
        status         : "pending"
      };

      const { error } = await supabase.from("payments").insert([insertData]);
      if (error) throw error;

      /* ================= WEB3FORMS NOTIFICATION ================= */
      try {
        await fetch("https://api.web3forms.com/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            access_key : "e6381f96-966a-4491-9847-98d0771b48c4",
            subject    : "New Payment Submitted 💰",
            message    : `
Payment received:

Name: ${fullname}
Email: ${email}
Matric: ${(detectedStudent || currentStudent)?.matric_number || "N/A"}
Amount: ${amount} ${currency}
Plan: ${plan_type || "N/A"}
Country: ${country || "N/A"}
Month: ${month}
Payment Method: ${method}
Receipt: ${receipt_url || "No receipt uploaded"}
`
          })
        });
      } catch (emailError) {
        console.error("Web3Forms notification failed:", emailError);
      }

      paymentForm.reset();

      if (currentStudent) {
        document.getElementById('student-name').value  = currentStudent.fullname || '';
        document.getElementById('student-email').value = currentStudent.email    || '';
      }

      showSuccess(t('Payment submitted successfully. We will confirm shortly.'));

    } catch (err) {
      console.error('Payment submission error:', err);
      showError(t('Something went wrong: ') + (err.message || JSON.stringify(err)));

    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  });

});