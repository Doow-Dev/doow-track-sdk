/**
 * Test the SDK against local backend (localhost:8080)
 *
 * Run: npx ts-node test-local.ts
 */

import { DoowManagement } from './src/management';

const API_KEY = 'dk_e1be2496eee0d96b0e014f86bf46f056cbc5e2c1f0244399243c186629306267';

async function main() {
  const mgmt = new DoowManagement(API_KEY, {
    endpoint: 'http://localhost:8080',
    debug: true,
  });

  console.log('\n=== Testing SDK Management Client ===\n');

  // 1. Create an app
  console.log('1. Creating app...');
  const app = await mgmt.apps.create({
    name: 'SDK Test App ' + Date.now(),
    description: 'Created via SDK',
  });
  console.log('   Created:', app.id, app.name);

  // 2. List apps
  console.log('\n2. Listing apps...');
  const apps = await mgmt.apps.list({ limit: 5 });
  console.log('   Found:', apps.data.length, 'apps');
  apps.data.forEach(a => console.log('   -', a.name));

  // 3. Create a contract with cost data and expenses
  console.log('\n3. Creating contract with cost data and expenses...');
  const contract = await mgmt.contracts.create(app.id, {
    title: 'Enterprise Plan',
    contract_type: 'ENTERPRISE',
    currency: 'USD',
    cost: 1200,
    total_contract_cost: 14400,
    cost_amortization: 'MONTHS',
    expenses: [
      { total: 120000, date: '2026-09-01', description: 'September payment' },
      { total: 120000, date: '2026-08-01', description: 'August payment' },
    ],
  });
  console.log('   Created:', contract.id, contract.title);
  console.log('   Cost:', contract.cost, contract.currency);
  console.log('   Total:', contract.total_contract_cost);
  console.log('   Expenses:', contract.expenses?.length ?? 0, 'attached');
  if (contract.expenses) {
    contract.expenses.forEach(exp => console.log('   -', exp.date, exp.total / 100, exp.description));
  }

  // 4. Create a license with pricing
  console.log('\n4. Creating license with pricing...');
  const license = await mgmt.licenses.create(contract.id, {
    name: 'API Usage License',
    license_type: 'USAGE_BASED',
    total_cost: 500,
    original_cost: 600,
    discount_amount: 100,
    discounted_cost: 500,
  });
  console.log('   Created:', license.id, license.name);
  console.log('   Cost:', license.total_cost, '(original:', license.original_cost, ')');

  // 5. Create a metric with telemetry config
  console.log('\n5. Creating metric with telemetry config...');
  const metric = await mgmt.metrics.create(license.id, {
    metric_type: 'api_calls',
    usage_aggregation_type: 'SUM',
    rate_kind: 'PER_UNIT',
    usage_rate: 0.001,
    usage_limit: 100000,
    entitlement_period: 'MONTHLY',
    usage_custom_unit_label: 'requests',
  });
  console.log('   Created:', metric.id, metric.metric_type);
  console.log('   Rate:', metric.usage_rate, 'per', metric.usage_custom_unit_label);
  console.log('   Limit:', metric.usage_limit, 'per', metric.entitlement_period);

  // 6. Update the app
  console.log('\n6. Updating app...');
  const updated = await mgmt.apps.update(app.id, {
    description: 'Updated via SDK',
  });
  console.log('   Updated:', updated.description);

  // 7. Get single resources
  console.log('\n7. Fetching single resources...');
  const fetchedApp = await mgmt.apps.get(app.id);
  const fetchedContract = await mgmt.contracts.get(contract.id);
  const fetchedLicense = await mgmt.licenses.get(license.id);
  const fetchedMetric = await mgmt.metrics.get(metric.id);
  console.log('   App:', fetchedApp.name);
  console.log('   Contract:', fetchedContract.title);
  console.log('   License:', fetchedLicense.name);
  console.log('   Metric:', fetchedMetric.metric_type);

  console.log('\n=== All tests passed! ===\n');
}

main().catch(err => {
  console.error('Error:', err.message);
  if (err.status) console.error('Status:', err.status);
  if (err.details) console.error('Details:', err.details);
  process.exit(1);
});
