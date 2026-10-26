import assert from 'node:assert/strict';
import { test } from 'node:test';
import { annualTotals } from '../src/annual-report.js';

test('annual totals add PostgreSQL string-valued amounts numerically', () => {
  const totals = annualTotals([
    { hotel_total_paise: '610050', food_total_paise: '30000', fuel_total_paise: '0', transport_total_paise: '0', other_total_paise: '0', total_paise: '640050' },
    { hotel_total_paise: '10025', food_total_paise: '9975', fuel_total_paise: '0', transport_total_paise: '0', other_total_paise: '0', total_paise: '20000' },
  ]);

  assert.deepEqual(totals, {
    hotel_paise: 620075,
    food_paise: 39975,
    fuel_paise: 0,
    transport_paise: 0,
    other_paise: 0,
    total_paise: 660050,
  });
});
