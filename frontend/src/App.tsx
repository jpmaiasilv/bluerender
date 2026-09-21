import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LanguageProvider } from './i18n';
import { AuthProvider } from './lib/auth/AuthProvider';
import { ProtectedRoute } from './components/ProtectedRoute';
import { RootLayout } from './layouts/RootLayout';
import { Home } from './pages/Home';
import { RenderPage } from './pages/RenderPage';
import { PlantaHumanizadaPage } from './pages/PlantaHumanizadaPage';
import { PlantaEditorPage } from './pages/PlantaEditorPage';
import { TextToImagePage } from './pages/TextToImagePage';
import { IdeaGeneratorPage } from './pages/IdeaGeneratorPage';
import { VideoGeneratorPage } from './pages/VideoGeneratorPage';
import { VideoEditorPage } from './pages/VideoEditorPage';
import { ArchitectChatPage } from './pages/ArchitectChatPage';
import { ComingSoonToolPage } from './pages/ComingSoonToolPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { HistoryPage } from './pages/HistoryPage';
import { HelpPage } from './pages/HelpPage';
import { SettingsPage } from './pages/SettingsPage';
import { ProfileSection } from './components/settings/ProfileSection';
import { PersonalDataSection } from './components/settings/PersonalDataSection';
import { OfficeSection } from './components/settings/OfficeSection';
import { BillingSection } from './components/settings/BillingSection';
import { CreditsSection } from './components/settings/CreditsSection';
import { ReferralsSection } from './components/settings/ReferralsSection';
import { PreferencesSection } from './components/settings/PreferencesSection';
import { SketchUpSection } from './components/settings/SketchUpSection';
import { LoginPage } from './pages/auth/LoginPage';
import { SignupPage } from './pages/auth/SignupPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { AuthCallbackPage } from './pages/auth/AuthCallbackPage';

// Lazy-loaded: pulls in recharts, which is otherwise unused by every other
// route — keeps the main bundle free of a chart library most sessions never touch.
const FinancialPage = lazy(() => import('./pages/FinancialPage').then((m) => ({ default: m.FinancialPage })));
// Lazy-loaded for the same reason — its own IndexedDB module, repositories,
// and board UI are only needed once someone actually opens Fluxo de Projetos.
const ProjectFlowPage = lazy(() => import('./pages/ProjectFlowPage').then((m) => ({ default: m.ProjectFlowPage })));
// Lazy-loaded: the public sales page is a large, self-contained bundle that
// almost no authenticated session ever visits — keeps it out of the main chunk.
const SalesPage = lazy(() => import('./pages/SalesPage').then((m) => ({ default: m.SalesPage })));

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <Routes>
          {/* The main domain's root is the public sales page — no subdomain, no auth gate.
              The authenticated app used to live at "/"; it now lives at "/painel" (see below). */}
          <Route
            path="/"
            element={
              <Suspense fallback={null}>
                <SalesPage />
              </Suspense>
            }
          />
          {/* Old URL kept working as a redirect to the new canonical "/" — never a dead link. */}
          <Route path="/pagina-de-vendas" element={<Navigate to="/" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/cadastro" element={<SignupPage />} />
          <Route path="/esqueci-senha" element={<ForgotPasswordPage />} />
          <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<RootLayout />}>
              <Route path="/painel" element={<Home />} />
              <Route path="/render" element={<RenderPage />} />
              <Route path="/planta-humanizada" element={<PlantaHumanizadaPage />} />
              <Route path="/planta-humanizada/editor" element={<PlantaEditorPage />} />
              <Route path="/imagem-por-texto" element={<TextToImagePage />} />
              <Route path="/gerador-de-ideias" element={<IdeaGeneratorPage />} />
              <Route path="/video-ia" element={<VideoGeneratorPage />} />
              <Route path="/video-editor" element={<VideoEditorPage />} />
              <Route path="/melhorar-render" element={<ComingSoonToolPage toolId="melhorarRender" />} />
              <Route path="/multiangulo" element={<ComingSoonToolPage toolId="multiangulo" />} />
              <Route path="/upscale" element={<ComingSoonToolPage toolId="upscale" />} />
              <Route path="/editor-ia" element={<ComingSoonToolPage toolId="editorIa" />} />
              <Route path="/arquiteto-estagiario" element={<ArchitectChatPage />} />
              <Route
                path="/financeiro"
                element={
                  <Suspense fallback={null}>
                    <FinancialPage />
                  </Suspense>
                }
              />
              <Route
                path="/project-flow"
                element={
                  <Suspense fallback={null}>
                    <ProjectFlowPage />
                  </Suspense>
                }
              />
              <Route path="/projetos" element={<ProjectsPage />} />
              <Route path="/historico" element={<HistoryPage />} />
              <Route path="/ajuda" element={<HelpPage />} />
              <Route path="/configuracoes" element={<SettingsPage />}>
                <Route index element={<Navigate to="perfil" replace />} />
                <Route path="perfil" element={<ProfileSection />} />
                <Route path="dados-pessoais" element={<PersonalDataSection />} />
                <Route path="escritorio" element={<OfficeSection />} />
                <Route path="plano" element={<BillingSection />} />
                <Route path="creditos" element={<CreditsSection />} />
                <Route path="indicacoes" element={<ReferralsSection />} />
                <Route path="preferencias" element={<PreferencesSection />} />
                <Route path="sketchup" element={<SketchUpSection />} />
              </Route>
              <Route path="*" element={<Home />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </LanguageProvider>
  );
}
