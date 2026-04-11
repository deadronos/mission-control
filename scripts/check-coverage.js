#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const summaryPath = path.join(process.cwd(), 'coverage', 'unit', 'coverage-summary.json');
if (!fs.existsSync(summaryPath)) {
  console.error('Coverage summary not found at', summaryPath);
  process.exit(2);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const total = summary.total || summary;

const thresholds = { lines: 80, statements: 80, branches: 70, functions: 80 };

const failures = [];
for (const [key, threshold] of Object.entries(thresholds)) {
  const metric = total[key];
  if (!metric || typeof metric.pct !== 'number') {
    failures.push(`${key}: missing`);
    continue;
  }
  if (metric.pct < threshold) {
    failures.push(`${key}: ${metric.pct}% < ${threshold}%`);
  }
}

if (failures.length > 0) {
  console.error('Coverage thresholds not met:');
  failures.forEach((f) => console.error('- ' + f));
  process.exit(1);
}

console.log('Coverage thresholds met');
process.exit(0);
