const RX = /\p{Extended_Pictographic}(\p{Emoji_Modifier}|️|‍\p{Extended_Pictographic})*/gu;

const samples = [
  'CPF: 156.789.234-50',
  'Salario R$ 4.800,00 em 18/05/2026',
  'gap-2 padding-4 fr 1fr 1.2fr',
  '8.82h trabalhadas',
  'const meses = ["Jan","Fev"];',
  'Botao 📄 Gerar PDF aqui',
  'Emoji 🤖 e 👤 misturados',
  'regex: (\\d{3})(\\d{3})',
  'Coracao ❤ negocio',
  'Check ✓ X ✕',
  'Setas → ←',
];

for (const s of samples) {
  const cleaned = s.replace(RX, '');
  console.log('IN :', JSON.stringify(s));
  console.log('OUT:', JSON.stringify(cleaned));
  console.log('');
}
