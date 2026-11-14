import { describe, expect, it } from 'vitest';
import { plainTextToHtml, toNuvemshopHtml } from '../connectors/strategy/nuvemshop-html.js';

describe('toNuvemshopHtml', () => {
  it('converte texto puro com parágrafo em <p>', () => {
    expect(toNuvemshopHtml('Linha 1\n\nLinha 2')).toBe('<p>Linha 1</p><p>Linha 2</p>');
  });

  it('converte quebra simples em <br>', () => {
    expect(toNuvemshopHtml('Linha 1\nLinha 2')).toBe('<p>Linha 1<br />Linha 2</p>');
  });

  it('escapa sinal de menor em texto puro', () => {
    expect(toNuvemshopHtml('5 < 10')).toBe('<p>5 &lt; 10</p>');
  });

  it('preserva HTML existente sem escapar de novo', () => {
    expect(toNuvemshopHtml('<p>Texto <strong>forte</strong></p>')).toBe('<p>Texto <strong>forte</strong></p>');
  });

  it('não transforma &amp; em &amp;amp;', () => {
    expect(toNuvemshopHtml('<p>A &amp; B</p>')).toBe('<p>A &amp; B</p>');
  });

  it('remove script, onerror e javascript:', () => {
    const clean = toNuvemshopHtml(
      '<p>ok</p><script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">link</a>'
    );
    expect(clean).toContain('<p>ok</p>');
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('javascript:');
  });

  it('injeta rel seguro em link externo', () => {
    expect(toNuvemshopHtml('<p><a href="https://exemplo.com">x</a></p>')).toContain(
      'rel="noopener noreferrer"'
    );
  });

  it('devolve null para entrada vazia ou só tags removidas', () => {
    expect(toNuvemshopHtml('')).toBeNull();
    expect(toNuvemshopHtml('   ')).toBeNull();
    expect(toNuvemshopHtml(null)).toBeNull();
    expect(toNuvemshopHtml('<script>alert(1)</script>')).toBeNull();
  });

  it('plainTextToHtml normaliza CRLF', () => {
    expect(plainTextToHtml('A\r\nB')).toBe('<p>A<br />B</p>');
  });
});
