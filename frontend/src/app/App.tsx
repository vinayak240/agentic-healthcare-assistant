import { startTransition, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { ChatShell } from '../features/chat/ChatShell';
import { OnboardingForm } from '../features/onboarding/OnboardingForm';
import { apiClient } from '../lib/api/client';
import type { CreateUserInput, User } from '../lib/api/types';
import { readStoredUser, writeStoredUser } from '../lib/storage';

type BootstrapStatus = 'booting' | 'ready';

function LoadingScreen() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f6f4ff_0%,#eef4ff_45%,#f8fbff_100%)] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6 py-10">
        <section className="w-full max-w-xl rounded-[32px] border border-white/80 bg-white/85 p-8 text-center shadow-[0_30px_90px_rgba(76,97,183,0.16)] backdrop-blur">
          <div className="mx-auto mb-5 h-14 w-14 rounded-2xl bg-[linear-gradient(135deg,#3867ff_0%,#88a5ff_100%)] p-3 text-white shadow-[0_20px_45px_rgba(56,103,255,0.3)]">
            <svg viewBox="0 0 24 24" fill="none" className="h-full w-full">
              <path
                d="M12 3.75 5.25 6.6v5.07c0 4.18 2.67 8.08 6.75 9.33 4.08-1.25 6.75-5.15 6.75-9.33V6.6L12 3.75Z"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path d="M9.5 12.2h5M12 9.7v5" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#3867ff]">
            MediBuddy
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
            Preparing your care workspace
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            Restoring your profile, checking backend health, and syncing conversations.
          </p>
          <div className="mx-auto mt-7 h-2 w-full max-w-sm overflow-hidden rounded-full bg-[#e5e9ff]">
            <div className="h-full w-2/3 rounded-full bg-[linear-gradient(90deg,#3867ff_0%,#7697ff_100%)] animate-progress-pulse" />
          </div>
        </section>
      </div>
    </main>
  );
}

interface RouteGuardProps {
  ready: boolean;
  currentUser: User | null;
}

function isSignedOutRoute(pathname: string): boolean {
  return pathname === '/onboarding' || pathname === '/login';
}

function ChatRouteGuard({ ready, currentUser }: RouteGuardProps) {
  if (!ready) {
    return <LoadingScreen />;
  }

  if (!currentUser) {
    return <Navigate to="/onboarding" replace />;
  }

  return null;
}

function SignedOutRouteGuard({ ready, currentUser }: RouteGuardProps) {
  if (!ready) {
    return <LoadingScreen />;
  }

  if (currentUser) {
    return <Navigate to="/" replace />;
  }

  return null;
}

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [bootstrapStatus, setBootstrapStatus] = useState<BootstrapStatus>('booting');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [backendHealthy, setBackendHealthy] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [creatingUser, setCreatingUser] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      const storedUser = readStoredUser();

      try {
        const health = await apiClient.getHealth();

        if (!active) {
          return;
        }

        setBackendHealthy(health.status === 'ok');
        setBootError(null);

        if (storedUser) {
          try {
            const validatedUser = await apiClient.getUser(storedUser.id);

            if (!active) {
              return;
            }

            startTransition(() => {
              setCurrentUser(validatedUser);
              setBootstrapStatus('ready');
            });
            writeStoredUser(validatedUser);

            if (isSignedOutRoute(location.pathname)) {
              navigate('/', { replace: true });
            }

            return;
          } catch {
            writeStoredUser(null);
          }
        }

        startTransition(() => {
          setCurrentUser(null);
          setBootstrapStatus('ready');
        });

        if (!isSignedOutRoute(location.pathname)) {
          navigate('/onboarding', { replace: true });
        }
      } catch (error) {
        if (!active) {
          return;
        }

        setBackendHealthy(false);
        setBootError(
          error instanceof Error
            ? error.message
            : 'Unable to reach the backend. Start the API and try again.',
        );

        if (storedUser) {
          startTransition(() => {
            setCurrentUser(storedUser);
            setBootstrapStatus('ready');
          });
          if (isSignedOutRoute(location.pathname)) {
            navigate('/', { replace: true });
          }
        } else {
          startTransition(() => {
            setCurrentUser(null);
            setBootstrapStatus('ready');
          });
          if (!isSignedOutRoute(location.pathname)) {
            navigate('/onboarding', { replace: true });
          }
        }
      }
    };

    void bootstrap();

    return () => {
      active = false;
    };
  }, [location.pathname, navigate]);

  const handleCreateUser = async (input: CreateUserInput) => {
    setCreatingUser(true);
    setOnboardingError(null);
    setLoginError(null);

    try {
      const user = await apiClient.createUser(input);

      startTransition(() => {
        setCurrentUser(user);
      });
      writeStoredUser(user);
      navigate('/', { replace: true });
    } catch (error) {
      setOnboardingError(
        error instanceof Error ? error.message : 'Could not create the patient profile.',
      );
    } finally {
      setCreatingUser(false);
    }
  };

  const handleLogin = async (email: string) => {
    setLoggingIn(true);
    setLoginError(null);
    setOnboardingError(null);

    try {
      const validatedUser = await apiClient.loginUser({ email });

      startTransition(() => {
        setCurrentUser(validatedUser);
      });
      writeStoredUser(validatedUser);
      navigate('/', { replace: true });
    } catch (error) {
      setLoginError(
        error instanceof Error ? error.message : 'Could not log in with that email.',
      );
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = () => {
    writeStoredUser(null);
    startTransition(() => {
      setCurrentUser(null);
    });
    navigate('/login', { replace: true });
  };

  const ready = bootstrapStatus === 'ready';

  return (
    <Routes>
      <Route
        path="/onboarding"
        element={
          <>
            <SignedOutRouteGuard ready={ready} currentUser={currentUser} />
            {!currentUser && ready && (
              <OnboardingForm
                pending={creatingUser}
                error={onboardingError}
                onSubmit={handleCreateUser}
                bootError={bootError}
              />
            )}
          </>
        }
      />
      <Route
        path="/login"
        element={
          <>
            <SignedOutRouteGuard ready={ready} currentUser={currentUser} />
            {!currentUser && ready && (
              <LoginPage
                onSubmit={handleLogin}
                pending={loggingIn}
                error={loginError}
                bootError={bootError}
              />
            )}
          </>
        }
      />
      <Route
        path="/"
        element={
          <>
            <ChatRouteGuard ready={ready} currentUser={currentUser} />
            {currentUser && ready && (
              <ChatShell
                user={currentUser}
                onLogout={handleLogout}
                backendHealthy={backendHealthy}
                bootError={bootError}
              />
            )}
          </>
        }
      />
      <Route
        path="*"
        element={<Navigate to={currentUser ? '/' : '/onboarding'} replace />}
      />
    </Routes>
  );
}
