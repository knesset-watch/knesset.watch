import { LoginForm } from '@/lib/ui';

export default function LoginPage() {
  return (
    <LoginForm 
      title="knesset.watch"
      endpoint="/api/auth"
      onSuccessRedirect="/"
      cookieName="knesset-watch_auth_token"
    />
  );
}
