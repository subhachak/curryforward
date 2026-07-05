"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { Card, CardBody } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ApiError } from "@/lib/api";

function LoginForm() {
  const { login } = useAuth();
  const { push } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(password);
      push("Logged in", "success");
      router.push(searchParams.get("redirect") || "/admin");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm py-16">
      <Card>
        <CardBody className="space-y-4">
          <div>
            <h1 className="text-lg font-semibold">Admin log in</h1>
            <p className="text-sm text-muted mt-1">
              Enter the admin secret from the backend&apos;s <code className="rounded bg-stone-100 px-1">.env</code>{" "}
              (<code className="rounded bg-stone-100 px-1">ADMIN_TOKEN</code>) to unlock copying,
              saving chat edits, and the review queue. Without it, you can still browse
              and try chat customization — previews just won&apos;t be saved.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium">
                Password
              </label>
              <Input
                id="password"
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Admin secret"
              />
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" className="w-full" loading={loading} disabled={!password}>
              Log in
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
