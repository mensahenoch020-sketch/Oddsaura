"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type AuthMode = "login" | "signup" | "forgot" | "reset";

function safeNextPath() {
  if (typeof window === "undefined") return "/dashboard";
  const value = new URLSearchParams(window.location.search).get("next") || "/dashboard";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

function sameOriginUrl(path: string) {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path.startsWith("/") ? path : `/${path}`}`;
}

export default function AuthForm({ mode }: { mode: AuthMode }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage(""); setError("");
    const form = new FormData(event.currentTarget);
    const body: Record<string, string | boolean> = {};
    for (const [key, value] of form.entries()) body[key] = String(value);
    if (mode === "reset") body.token = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("token") || "";
    if (mode === "signup") body.acceptedTerms = form.get("acceptedTerms") === "on";
    const endpoint = mode === "forgot" ? "/api/auth/forgot-password" : mode === "reset" ? "/api/auth/reset-password" : `/api/auth/${mode}`;
    let destination = "";
    try {
      // Use an absolute same-origin URL. Some iOS in-app browsers reject relative
      // fetch/navigation URLs with a DOMException before the request is sent.
      const response = await fetch(sameOriginUrl(endpoint), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const responseText = await response.text();
      let payload: { error?: string; message?: string } = {};
      try { payload = responseText ? JSON.parse(responseText) as typeof payload : {}; }
      catch { payload = { error: response.ok ? undefined : "The account service returned an invalid response. Please try again." }; }
      if (!response.ok) throw new Error(payload.error || "Please check your details and try again.");
      if (mode === "login" || mode === "signup") {
        destination = sameOriginUrl(safeNextPath());
        setMessage(mode === "signup" ? "Account created. Opening your dashboard…" : "Signed in. Opening your dashboard…");
      }
      else if (mode === "reset") { setMessage(payload.message || "Password updated. You can now log in."); destination = sameOriginUrl("/login"); }
      else setMessage(payload.message || "If that email is registered, a reset link is on its way.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong. Please try again.");
    } finally { setBusy(false); }
    if (destination) {
      // Keep navigation outside the request error handler so a browser-specific
      // redirect failure can never be presented as a failed signup.
      window.setTimeout(() => { window.location.href = destination; }, mode === "reset" ? 1200 : 0);
    }
  }

  const needsPassword = mode === "login" || mode === "signup" || mode === "reset";
  return <form className="auth-form" onSubmit={submit}>
    {mode === "signup" && <label><span>Full name</span><input name="name" type="text" autoComplete="name" minLength={2} maxLength={60} required placeholder="Your name" /></label>}
    {mode !== "reset" && <label><span>Email address</span><input name="email" type="email" autoComplete="email" required placeholder="you@example.com" /></label>}
    {needsPassword && <label><span>{mode === "reset" ? "New password" : "Password"}</span><div className="password-field"><input name={mode === "reset" ? "newPassword" : "password"} type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required placeholder="At least 8 characters" /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button></div></label>}
    {(mode === "signup" || mode === "reset") && <label><span>Confirm password</span><input name="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required placeholder="Enter it again" /></label>}
    {mode === "login" && <div className="auth-form-row"><label className="check-label"><input name="remember" type="checkbox" /> <span>Keep me signed in</span></label><Link href="/forgot-password">Forgot password?</Link></div>}
    {mode === "signup" && <label className="check-label auth-terms"><input name="acceptedTerms" type="checkbox" required /> <span>I am 18 or older and agree to the Terms and Privacy Policy.</span></label>}
    {error && <p className="auth-alert auth-error" role="alert">{error}</p>}
    {message && <p className="auth-alert auth-success" role="status">{message}</p>}
    <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Log in" : mode === "signup" ? "Create my account" : mode === "forgot" ? "Send reset link" : "Reset password"}</button>
  </form>;
}
