import { memo } from 'react';
import art from '../art/vesper.svg?raw';

export type VesperMood = 'idle' | 'watch' | 'suspense' | 'rift' | 'win' | 'bigwin';

/**
 * Vesper, el anfitrión con cabeza de moneda y una cerradura al vacío por cara.
 * Cada parte del SVG es una capa con clase propia; el CSS la anima según `data-mood`.
 * El SVG es un recurso estático del propio bundle (no lleva nada del usuario), por eso
 * es seguro insertarlo tal cual: así conserva sus capas sin traducirlo a JSX.
 */
export const Vesper = memo(function Vesper({ mood }: { mood: VesperMood }) {
  return <div className="vesper" data-mood={mood} dangerouslySetInnerHTML={{ __html: art }} />;
});
