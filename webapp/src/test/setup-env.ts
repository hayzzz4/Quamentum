import { config } from 'dotenv';

config({ path: '.env.local' });

// Every test run talks to the test database, never the dev one.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
