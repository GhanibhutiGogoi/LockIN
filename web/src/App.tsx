import { useEffect } from 'react';
import { DeskScreen } from './components/DeskScreen';
import { IntegrationsPanel, SHOW_INTEGRATIONS } from './components/IntegrationsPanel';
import { ReportScreen } from './components/ReportScreen';
import { SettingsSheet } from './components/SettingsSheet';
import { SetupScreen } from './components/SetupScreen';
import { StudyScreen } from './components/StudyScreen';
import { Toast } from './components/Toast';
import { actions, applyTheme, useApp } from './store';

export function App() {
  const screen = useApp((s) => s.screen);
  const theme = useApp((s) => s.theme);
  const selected = useApp((s) => s.decks.some((d) => d.id === s.deckId));
  useEffect(() => { void actions.loadLibrary(); }, []);
  useEffect(() => {
    applyTheme(theme);
    // the browser chrome follows a forced theme too, not only the system one
    const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    metas.forEach((m) => {
      const media = m.getAttribute('data-media') ?? m.media;
      m.setAttribute('data-media', media);
      const own = media.includes('dark') ? '#0e0f11' : '#f1f2f4';
      m.content = theme === 'system' ? own : theme === 'dark' ? '#0e0f11' : '#f1f2f4';
    });
  }, [theme]);

  return (
    <>
      {(screen === 'desk' || ((screen === 'study' || screen === 'setup') && !selected)) && <DeskScreen />}
      {screen === 'setup' && selected && <SetupScreen />}
      {screen === 'study' && selected && <StudyScreen />}
      {screen === 'report' && <ReportScreen />}
      <SettingsSheet />
      <Toast />
      {SHOW_INTEGRATIONS && <IntegrationsPanel />}
    </>
  );
}
