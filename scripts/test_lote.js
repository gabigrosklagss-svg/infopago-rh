const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env') });
const { calcularHolerite } = require('../src/services/payroll');

// Simula geração do lote pros 2 ativos do mês 6
const empMariana1 = { id: 'f167af7d', nome_completo: 'Mariana Souza', salario_base: 4800, num_dependentes: 0, carga_horaria_semanal: 44, data_admissao: '2026-05-18' };
const empMariana2 = { id: 'fa3b88e4', nome_completo: 'Mariana Ferreira', salario_base: 4700, num_dependentes: 0, carga_horaria_semanal: 44, data_admissao: '2026-05-31' };

for (const emp of [empMariana1, empMariana2]) {
  try {
    const calc = calcularHolerite(emp, { data_pagamento: '2026-07-05' }, 2026);
    console.log(`✓ ${emp.nome_completo}: bruto=${calc.total_proventos} liquido=${calc.salario_liquido}`);
  } catch (e) {
    console.error(`✗ ${emp.nome_completo}: ${e.message}`);
  }
}
