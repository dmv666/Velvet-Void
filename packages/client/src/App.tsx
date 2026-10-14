import { useEffect, useState } from 'react';
import type { UserDto } from '@velvet/shared';
import { api } from './api';
import { Game } from './Game';
import { AuthScreen } from './hud/AuthScreen';

export function App() {
  const [user, setUser] = useState<UserDto | null | undefined>(undefined);

  const refresh = () =>
    api
      .me()
      .then(setUser)
      // 401 (sin sesión) o servidor caído: en ambos casos, pantalla de acceso.
      .catch(() => setUser(null));

  useEffect(() => void refresh(), []);

  if (user === undefined) return null;
  if (user === null) return <AuthScreen onAuthed={() => void refresh()} />;
  return (
    <Game
      key={user.id}
      user={user}
      onLogout={() => void api.logout().finally(() => setUser(null))}
    />
  );
}
