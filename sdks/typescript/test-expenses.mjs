/**
 * Test SDK contract creation with expenses
 */

import { DoowManagement } from './dist/esm/management.js';

const API_KEY = 'dk_e1be2496eee0d96b0e014f86bf46f056cbc5e2c1f0244399243c186629306267';

async function main() {
  const mgmt = new DoowManagement(API_KEY, {
    endpoint: 'http://localhost:8080',
    debug: true,
  });

  console.log('\n=== Testing SDK Contract with Expenses ===\n');

  // 1. Create an app
  console.log('1. Creating app...');
  const app = await mgmt.apps.create({
    name: 'Expense Test App ' + Date.now(),
    description: 'Testing expense creation',
  });
  console.log('   Created:', app.id, app.name);

  // 2. Create a contract with licenses and expenses (both required)
  console.log('\n2. Creating contract with licenses and expenses...');
  const contract = await mgmt.contracts.create(app.id, {
    title: 'Enterprise Plan',
    contract_type: 'ENTERPRISE',
    currency: 'USD',
    cost: 1200,
    total_contract_cost: 14400,
    cost_amortization: 'MONTHS',
    licenses: [
      {
        name: 'Enterprise Seats',
        license_type: 'SEAT_BASED',
        seats: 10,
        total_cost: 1200,
        price_per_seat: 120,
      },
    ],
    expenses: [
      { total: 120000, date: '2026-09-01', description: 'September payment' },
      { total: 120000, date: '2026-08-01', description: 'August payment' },
    ],
  });
  console.log('   Created:', contract.id, contract.title);
  console.log('   Cost:', contract.cost, contract.currency);
  console.log('   Total:', contract.total_contract_cost);
  console.log('   Licenses attached:', contract.licenses?.length ?? 0);
  console.log('   Expenses attached:', contract.expenses?.length ?? 0);

  if (contract.licenses && contract.licenses.length > 0) {
    console.log('   Licenses:');
    contract.licenses.forEach(lic => {
      console.log(`     - ${lic.name}: ${lic.license_type}, ${lic.seats} seats, $${lic.total_cost}`);
    });
  }

  if (contract.expenses && contract.expenses.length > 0) {
    console.log('   Expenses:');
    contract.expenses.forEach(exp => {
      console.log(`     - ${exp.date}: $${exp.total / 100} (${exp.description})`);
    });
  }

  // 3. Fetch contract to verify licenses and expenses are included
  console.log('\n3. Fetching contract to verify...');
  const fetched = await mgmt.contracts.get(contract.id);
  console.log('   Contract:', fetched.title);
  console.log('   Licenses in response:', fetched.licenses?.length ?? 0);
  console.log('   Expenses in response:', fetched.expenses?.length ?? 0);

  console.log('\n=== Test complete! ===\n');
  console.log('App ID:', app.id);
  console.log('Contract ID:', contract.id);
  if (contract.licenses?.[0]) {
    console.log('License ID:', contract.licenses[0].id);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  if (err.status) console.error('Status:', err.status);
  if (err.details) console.error('Details:', err.details);
  process.exit(1);
});
