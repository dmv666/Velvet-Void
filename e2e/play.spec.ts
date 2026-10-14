import { expect, test, type Page } from '@playwright/test';

const name = () => `e2e_${Math.random().toString(36).slice(2, 12)}`;

async function register(page: Page) {
  await page.goto('/');
  await page.getByLabel('Nombre').fill(name());
  await page.getByLabel('Contraseña').fill('contraseña-e2e-segura');
  await page.getByRole('button', { name: /Crear cuenta/ }).click();
  await expect(page.getByTestId('balance')).toHaveText('10.000,00');
}

async function serverBalance(page: Page): Promise<string> {
  const me = await page.request.get('/api/me');
  return (await me.json()).balance as string;
}

const toUnits = (text: string) => BigInt(text.replace(/\./g, '').replace(',', ''));

test('registrarse, girar y que el saldo de la UI cuadre con el del servidor', async ({ page }) => {
  const cspErrors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && /Content Security Policy|Refused to/.test(m.text()) && cspErrors.push(m.text()));

  await register(page);
  for (let i = 0; i < 3; i++) {
    await page.getByTestId('spin').click();
    await expect(page.getByTestId('spin')).toBeDisabled();
    await expect(page.getByTestId('spin')).toBeEnabled({ timeout: 40_000 });
    await expect(page.getByTestId('last-win')).not.toBeEmpty();
  }
  expect(toUnits((await page.getByTestId('balance').textContent())!)).toBe(BigInt(await serverBalance(page)));
  expect(cspErrors).toEqual([]);
  await page.screenshot({ path: `test-results/game-${test.info().project.name}.png` });
});

test('turbo y teclado: la barra espaciadora también gira', async ({ page }) => {
  await register(page);
  await expect(page.getByTestId('spin')).toBeEnabled(); // escenario listo
  await page.getByRole('button', { name: 'Turbo' }).click();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('spin')).toBeDisabled();
  await expect(page.getByTestId('spin')).toBeEnabled({ timeout: 40_000 });
  // El Espacio no debe "pulsar" además el botón Turbo que tenía el foco.
  await expect(page.getByRole('button', { name: 'Turbo' })).toHaveAttribute('aria-pressed', 'true');
  expect(toUnits((await page.getByTestId('balance').textContent())!)).toBe(BigInt(await serverBalance(page)));
});

test('provably fair: rotar, revelar y verificar una ronda en el navegador', async ({ page }) => {
  await register(page);
  await page.getByTestId('spin').click();
  await expect(page.getByTestId('last-win')).not.toBeEmpty({ timeout: 40_000 });

  await page.getByRole('button', { name: 'Juego justo' }).click();
  await page.getByRole('button', { name: 'Revelar semilla y rotar' }).click();
  await expect(page.getByText('coincide con el hash que viste antes de jugar')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar' }).click();

  await page.getByRole('button', { name: 'Historial' }).click();
  await page.getByRole('button', { name: 'Verificar' }).first().click();
  await page.getByRole('button', { name: 'Verificar en este navegador' }).click();
  await expect(page.getByText('La semilla corresponde al hash publicado')).toBeVisible();
  await expect(page.getByText('El resultado recalculado es idéntico al registrado')).toBeVisible();
  await expect(page.getByText('El premio registrado cuadra')).toBeVisible();
  await expect(page.locator('.bad')).toHaveCount(0);
  await page.screenshot({ path: `test-results/fair-${test.info().project.name}.png` });
});

test('reglas: la tabla de pagos y el RTP vienen del servidor', async ({ page }) => {
  await register(page);
  await page.getByRole('button', { name: 'Reglas' }).click();
  await expect(page.getByText('RTP teórico')).toBeVisible();
  await expect(page.getByRole('cell', { name: /96,1|96\.1/ })).toBeVisible();
});
