"use client";

import { FormEvent, useState } from "react";

async function submitJson(path: string, method: string, body?: unknown) {
  const response = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json() as { error?: string; message?: string; user?: { name: string } };
  if (!response.ok) throw new Error(payload.error || "The change could not be saved.");
  return payload;
}

export default function AccountSettings({ initialName, email }: { initialName: string; email: string }) {
  const [name, setName] = useState(initialName);
  const [profileMessage, setProfileMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("profile"); setError(""); setProfileMessage("");
    try { const payload = await submitJson("/api/auth/profile", "PATCH", { name }); setName(payload.user?.name || name); setProfileMessage("Profile updated."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Profile could not be updated."); }
    finally { setBusy(""); }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("password"); setError(""); setPasswordMessage("");
    const form = new FormData(event.currentTarget);
    try { const payload = await submitJson("/api/auth/change-password", "POST", Object.fromEntries(form)); setPasswordMessage(payload.message || "Password changed."); event.currentTarget.reset(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Password could not be changed."); }
    finally { setBusy(""); }
  }

  async function logout() {
    setBusy("logout");
    try { await submitJson("/api/auth/logout", "POST"); window.location.assign("/"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not log out."); setBusy(""); }
  }

  return <section className="settings-grid">
    {error && <p className="account-error" role="alert">{error}</p>}
    <form onSubmit={updateProfile}><span>Profile</span><h2>Your details</h2><label><b>Display name</b><input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={60} required /></label><label><b>Email address</b><input value={email} disabled /></label>{profileMessage && <p className="account-success">{profileMessage}</p>}<button disabled={busy === "profile"}>{busy === "profile" ? "Saving…" : "Save profile"}</button></form>
    <form onSubmit={changePassword}><span>Security</span><h2>Change password</h2><label><b>Current password</b><input name="currentPassword" type="password" autoComplete="current-password" minLength={8} required /></label><label><b>New password</b><input name="newPassword" type="password" autoComplete="new-password" minLength={8} required /></label><label><b>Confirm new password</b><input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required /></label>{passwordMessage && <p className="account-success">{passwordMessage}</p>}<button disabled={busy === "password"}>{busy === "password" ? "Updating…" : "Update password"}</button></form>
    <article className="session-card"><span>Session</span><h2>Sign out</h2><button type="button" onClick={() => void logout()} disabled={busy === "logout"}>{busy === "logout" ? "Logging out…" : "Log out"}</button></article>
  </section>;
}

