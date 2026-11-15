import 'dotenv/config';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL_TEST ??= 'postgres://docuvault:docuvault@localhost:5432/docuvault_test';
process.env.DATABASE_URL ??= 'postgres://docuvault:docuvault@localhost:5432/docuvault_dev';
