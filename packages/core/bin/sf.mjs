#!/usr/bin/env node
// Vỏ mỏng: mọi logic ở dist/cli/main.js (constitution Điều II).
import { main } from '../dist/cli/main.js';

process.exitCode = await main(process.argv.slice(2));
