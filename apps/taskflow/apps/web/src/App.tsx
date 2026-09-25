import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { TASK_VIEWS, type TaskView } from '@taskflow/shared';
import { RedirectIfAuthed, RequireAuth, SplashScreen } from './features/auth/RequireAuth';
import { AppShell } from './layout/AppShell';
import { NotFoundPage } from './pages/NotFoundPage';

// Route-level code splitting: signed-in users never download the auth pages and vice versa.
const LoginPage = lazy(() => import('./features/auth/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('./features/auth/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
import { TasksPage } from './pages/TasksPage';

function ViewRoute() {
  const { view } = useParams();
  return TASK_VIEWS.includes(view as TaskView) ? <TasksPage /> : <NotFoundPage />;
}

export function App() {
  return (
    <Suspense fallback={<SplashScreen />}>
    <Routes>
      <Route path="/login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
      <Route path="/register" element={<RedirectIfAuthed><RegisterPage /></RedirectIfAuthed>} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<Navigate to="/today" replace />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/projects/:projectId" element={<TasksPage />} />
        <Route path="/tags/:tag" element={<TasksPage />} />
        <Route path="/:view" element={<ViewRoute />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
