import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { Vesper } from './Vesper';

export function AuthScreen({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await (mode === 'login' ? api.login : api.register)({ username, password });
      onAuthed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'algo salió mal');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <form onSubmit={submit} aria-labelledby="auth-title">
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Vesper mood="idle" />
        </div>
        <h1 id="auth-title">Velvet Void</h1>
        <p className="tagline">El terciopelo cede. La luz se escapa.</p>
        <div className="field">
          <label htmlFor="u">Nombre</label>
          <input id="u" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" />
        </div>
        <div className="field">
          <label htmlFor="p">Contraseña</label>
          <input
            id="p"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={10}
            maxLength={128}
          />
        </div>
        {error && (
          <p className="bad" role="alert">
            {error}
          </p>
        )}
        <button className="primary" style={{ width: '100%', marginTop: 8 }} disabled={busy}>
          {mode === 'login' ? 'Entrar' : 'Crear cuenta · 10.000 créditos'}
        </button>
        <button type="button" className="switch" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? '¿Primera vez? Crea una cuenta' : 'Ya tengo cuenta'}
        </button>
        <p className="disclaimer">
          Proyecto educativo. Créditos 100 % ficticios: no se compran, no se cobran, no valen nada.
        </p>
      </form>
    </main>
  );
}
