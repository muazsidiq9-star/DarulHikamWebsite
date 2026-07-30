// supabase/functions/verify-flutterwave-payment/index.ts
//
// Verifies a Flutterwave transaction server-side (never trusting the
// client-side "successful" callback alone), records it in `payments`,
// flips `students.payment_status`, and sends the same notification
// pattern used by the admin dashboard's manual "Mark Paid" action.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const FLUTTERWAVE_SECRET_KEY = Deno.env.get("FLUTTERWAVE_SECRET_KEY");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !FLUTTERWAVE_SECRET_KEY) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // tighten to your actual domain(s) once live
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Bare month name only (e.g. "July") — matches the existing <select id="month">
// dropdown values used by manual bank-transfer submissions, so a payment's
// "month" reads the same way in your admin dashboard regardless of how it
// was paid.
function currentMonthName(): string {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return months[new Date().getMonth()];
}

Deno.serve(async (req) => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, message: "Method not allowed" }, 405);
  }

  let body: {
    transaction_id?: string | number;
    tx_ref?: string;
    matric_number?: string;
    payer_name?: string;
    payer_email?: string;
    expected_amount?: number;
    expected_currency?: string;
    plan_type?: string;
    country?: string;
  };

  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, message: "Invalid JSON body" }, 400);
  }

  const {
    transaction_id,
    tx_ref,
    matric_number,
    payer_name,
    payer_email,
    expected_amount,
    expected_currency,
    plan_type,
    country,
  } = body;

  if (!transaction_id || !payer_email || !expected_amount || !expected_currency) {
    return jsonResponse(
      { success: false, message: "Missing required fields for verification." },
      400
    );
  }

  try {
    // ---------------------------------------------------------
    // 1. Verify the transaction directly with Flutterwave
    //    (secret key only ever used server-side, never exposed)
    // ---------------------------------------------------------
    const verifyRes = await fetch(
      `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${FLUTTERWAVE_SECRET_KEY}`,
        },
      }
    );

    const verifyJson = await verifyRes.json();

console.log(
  "Flutterwave verification response:",
  JSON.stringify({
    status: verifyJson.status,
    message: verifyJson.message,
    data: verifyJson.data
      ? {
          id: verifyJson.data.id,
          status: verifyJson.data.status,
          amount: verifyJson.data.amount,
          currency: verifyJson.data.currency,
          tx_ref: verifyJson.data.tx_ref,
        }
      : null,
  })
);

    if (!verifyRes.ok || verifyJson.status !== "success") {
      return jsonResponse(
        { success: false, message: "Flutterwave could not confirm this transaction." },
        400
      );
    }

    const txData = verifyJson.data;

    // ---------------------------------------------------------
    // 2. Confirm the transaction actually succeeded, and that the
    //    amount/currency match what we expected — protects against
    //    a tampered client-side amount or currency downgrade.
    // ---------------------------------------------------------
    const amountMatches = Number(txData.amount) >= Number(expected_amount);
    const currencyMatches = txData.currency === expected_currency;
    const statusOk = txData.status === "successful";

    if (!statusOk || !amountMatches || !currencyMatches) {
      return jsonResponse(
        {
          success: false,
          message: "Transaction verification mismatch (status/amount/currency).",
        },
        400
      );
    }

    // Cross-check the paying email matches the registered student
    // (defence in depth — inline checkout already sets this, but
    // this guards against any tampering of the request payload).
    const payingEmail = (txData.customer?.email || "").toLowerCase().trim();
    if (payingEmail && payingEmail !== payer_email.toLowerCase().trim()) {
      return jsonResponse(
        { success: false, message: "Payer email does not match registered student email." },
        400
      );
    }

    // ---------------------------------------------------------
    // 2b. Fetch level_arabic / country / plan_type from the students
    //     table server-side, rather than trusting whatever the browser
    //     sent — same "never trust the client" principle already
    //     applied to amount/currency. This also guarantees level_arabic
    //     is populated, since `payments.level_arabic` is NOT NULL.
    // ---------------------------------------------------------
    let studentRecord: { level_arabic?: string; country?: string; plan_type?: string } | null = null;

    if (matric_number) {
      const { data: studentData, error: studentFetchError } = await supabase
        .from("students")
        .select("level_arabic, country, plan_type")
        .eq("matric_number", matric_number)
        .maybeSingle();

      if (studentFetchError) {
        console.error("Student fetch by matric_number failed:", studentFetchError);
      } else {
        studentRecord = studentData;
      }
    }

    // Fallback: if no matric_number was supplied, or the lookup found
    // nothing, try by email before giving up.
    if (!studentRecord) {
      const { data: studentByEmail, error: emailFetchError } = await supabase
        .from("students")
        .select("level_arabic, country, plan_type")
        .eq("email", payer_email)
        .maybeSingle();

      if (emailFetchError) {
        console.error("Student fetch by email failed:", emailFetchError);
      } else {
        studentRecord = studentByEmail;
      }
    }

    // level_arabic is NOT NULL on payments — this fallback string ensures
    // we never hard-fail an otherwise-valid, verified payment just because
    // the student record couldn't be found for some unexpected reason.
    const resolvedLevelArabic = studentRecord?.level_arabic || "Not specified";
    const resolvedCountry = studentRecord?.country || country || null;
    const resolvedPlanType = studentRecord?.plan_type || plan_type || null;

    // ---------------------------------------------------------
    // 3. Record the payment (unique index on flutterwave_tx_id
    //    prevents double-crediting if this runs twice)
    // ---------------------------------------------------------
    const { error: insertError } = await supabase.from("payments").insert([
      {
        matric_number: matric_number || null,
        payer_name: payer_name || txData.customer?.name || "",
        payer_email: payer_email,
        country: resolvedCountry,
        plan_type: resolvedPlanType,
        level_arabic: resolvedLevelArabic,
        month: currentMonthName(),
        payment_method: "Flutterwave",
        amount: txData.amount,
        currency: txData.currency,
        provider: "flutterwave",
        flutterwave_tx_ref: tx_ref || txData.tx_ref,
        flutterwave_tx_id: String(transaction_id),
        status: "paid",
        verification_status: "verified",
      },
    ]);

    if (insertError) {
      // Unique violation on flutterwave_tx_id means this exact transaction was
      // already recorded (e.g. student refreshed the success page, or the
      // callback fired twice). Return immediately here — this is the fix:
      // without this early return, execution would fall through to step 5
      // below and insert a DUPLICATE "Payment Confirmed" notification every
      // time this endpoint gets called again for the same transaction.
      if (insertError.code === "23505") {
        return jsonResponse({
          success: true,
          message: "Payment already recorded previously.",
        });
      }
      console.error("Payment insert error:", insertError);
      return jsonResponse(
        { success: false, message: "Payment verified but could not be recorded. Contact support." },
        500
      );
    }

    // ---------------------------------------------------------
    // 4. Flip student payment_status (best-effort — not load-bearing
    //    for admin-dashboard today, but kept for future use)
    // ---------------------------------------------------------
    if (matric_number) {
      const { error: studentUpdateError } = await supabase
        .from("students")
        .update({ payment_status: "paid" })
        .eq("matric_number", matric_number);

      if (studentUpdateError) {
        console.error("students.payment_status update error:", studentUpdateError);
        // Non-fatal — payment is already recorded; don't fail the whole request over this.
      }

      // ---------------------------------------------------------
      // 5. Send the same notification pattern used by admin-dashboard's
      //    manual "Mark Paid" action. Only reached once per unique
      //    transaction now, thanks to the early return above.
      // ---------------------------------------------------------
      const { error: notifError } = await supabase.from("notifications").insert([
        {
          matric_number: matric_number,
          title: "Payment Confirmed",
          message: JSON.stringify({
            key: "PAYMENT_CONFIRMED",
            data: {
              amount: Number(txData.amount).toLocaleString(),
              month: currentMonthName(),
            },
          }),
          created_at: new Date().toISOString(),
        },
      ]);

      if (notifError) {
        console.error("Notification insert error:", notifError);
        // Non-fatal — don't fail the whole request over a notification issue.
      }
    }

    return jsonResponse({
  success: true,
  message: "Payment verified successfully.",
});
  } catch (err) {
    console.error("Unexpected verification error:", err);
    return jsonResponse(
      { success: false, message: "Unexpected server error during verification." },
      500
    );
  }
});