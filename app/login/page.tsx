"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, Lock, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabaseBrowser } from "@/lib/supabase-client";
import { clearAllCaches, setDbAuthToken } from "@/lib/db-client";

type Mode = "password" | "magic" | "reset" | "update-password";

function setLoggedInCookie(expiresIn: number) {
  document.cookie = `sb-logged-in=1; path=/; max-age=${expiresIn}; SameSite=Lax`;
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);

  useEffect(() => {
    const sb = getSupabaseBrowser();
    if (new URLSearchParams(window.location.search).get("mode") === "update-password") {
      setMode("update-password");
    }
    if (!sb) return;
    const { data } = sb.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("update-password");
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const sb = getSupabaseBrowser();
    if (!sb) {
      setError("Auth is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      setLoading(false);
      return;
    }

    try {
      if (mode === "update-password") {
        if (password.length < 8) {
          setError("Use at least 8 characters for the new password.");
          setLoading(false);
          return;
        }
        if (password !== confirmPassword) {
          setError("Passwords do not match.");
          setLoading(false);
          return;
        }
        const { data, error } = await sb.auth.updateUser({ password });
        if (error) setError(error.message);
        else {
          const { data: sessionData } = await sb.auth.getSession();
          if (sessionData.session) {
            setDbAuthToken(sessionData.session.access_token);
            clearAllCaches();
            setLoggedInCookie(sessionData.session.expires_in ?? 3600);
          }
          setPasswordUpdated(!!data.user);
        }
        setLoading(false);
        return;
      }

      if (mode === "magic") {
        const { error } = await sb.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: true },
        });
        if (error) setError(error.message);
        else setMagicSent(true);
        setLoading(false);
        return;
      }

      if (mode === "reset") {
        const { error } = await sb.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/login?mode=update-password`,
        });
        if (error) setError(error.message);
        else setResetSent(true);
        setLoading(false);
        return;
      }

      // Password login
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      if (data.session) {
        setDbAuthToken(data.session.access_token);
        clearAllCaches();
        setLoggedInCookie(data.session.expires_in ?? 3600);
        router.push("/");
      }
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed — check your network connection.");
      setLoading(false);
    }
  }

  if (resetSent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Mail className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>Check your email</CardTitle>
            <CardDescription>
              We sent a password reset link to <strong>{email}</strong>. Click it to set a new password.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (magicSent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Mail className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>Check your email</CardTitle>
            <CardDescription>
              We sent a link to <strong>{email}</strong>. Click it to sign in.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (passwordUpdated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle>Password updated</CardTitle>
            <CardDescription>Your new password is ready to use.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => router.push("/")}>Continue to workspace</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Zap className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Stellar Toolkit</CardTitle>
          <CardDescription>Sign in to access your workspace</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode !== "update-password" && <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                  required
                  autoComplete="email"
                />
              </div>
            </div>}

            {(mode === "password" || mode === "update-password") && (
              <div className="space-y-2">
                <Label htmlFor="password">{mode === "update-password" ? "New password" : "Password"}</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-9"
                    required
                    autoComplete={mode === "update-password" ? "new-password" : "current-password"}
                  />
                </div>
              </div>
            )}

            {mode === "update-password" && (
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive rounded-md bg-destructive/10 px-3 py-2">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "password" ? "Sign in / Sign up" : mode === "magic" ? "Send magic link" : mode === "reset" ? "Send reset link" : "Update password"}
            </Button>

            <div className="flex flex-col gap-1 pt-1 border-t border-border">
              {mode === "password" && (
                <>
                  <button
                    type="button"
                    className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
                    onClick={() => { setMode("magic"); setError(null); }}
                  >
                    Sign in with magic link →
                  </button>
                  <button
                    type="button"
                    className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
                    onClick={() => { setMode("reset"); setError(null); }}
                  >
                    Forgot password? →
                  </button>
                </>
              )}
              {(mode === "magic" || mode === "reset") && (
                <button
                  type="button"
                  className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
                  onClick={() => { setMode("password"); setError(null); }}
                >
                  ← Back to password sign in
                </button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
