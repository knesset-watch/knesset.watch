import { LoginForm } from '@/lib/ui';

export default function LoginPage() {
  return (
    <LoginForm 
      title="אפרכסת לכנסת"
      endpoint="/api/auth"
      onSuccessRedirect="/"
      cookieName="knesset-watch_auth_token"
    />
  );
}
