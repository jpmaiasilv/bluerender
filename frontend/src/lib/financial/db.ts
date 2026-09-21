import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { FinancialCategory, FinancialTransaction, RecurrenceRule } from './types';

const DB_NAME = 'blue-render-financial';
const DB_VERSION = 1;

interface FinancialDB extends DBSchema {
  transactions: {
    key: string;
    value: FinancialTransaction;
    indexes: {
      transactionDate: string;
      dueDate: string;
      type: string;
      categoryId: string;
      projectId: string;
      clientId: string;
      recurrenceRuleId: string;
    };
  };
  categories: {
    key: string;
    value: FinancialCategory;
    indexes: { type: string };
  };
  recurrenceRules: {
    key: string;
    value: RecurrenceRule;
  };
}

const DEFAULT_INCOME_CATEGORIES = [
  'Honorários',
  'Entrada de contrato',
  'Parcela de projeto',
  'Consultoria',
  'Acompanhamento de obra',
  'Renderização',
  'Outros',
];

const DEFAULT_EXPENSE_CATEGORIES = [
  'Software',
  'Equipe',
  'Freelancer',
  'Impostos',
  'Marketing',
  'Equipamentos',
  'Impressão',
  'Deslocamento',
  'Serviços terceirizados',
  'Escritório',
  'Internet',
  'Outros',
];

let dbPromise: Promise<IDBPDatabase<FinancialDB>> | null = null;

export function getFinancialDb(): Promise<IDBPDatabase<FinancialDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FinancialDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const transactions = db.createObjectStore('transactions', { keyPath: 'id' });
          transactions.createIndex('transactionDate', 'transactionDate');
          transactions.createIndex('dueDate', 'dueDate');
          transactions.createIndex('type', 'type');
          transactions.createIndex('categoryId', 'categoryId');
          transactions.createIndex('projectId', 'projectId');
          transactions.createIndex('clientId', 'clientId');
          transactions.createIndex('recurrenceRuleId', 'recurrenceRuleId');

          const categories = db.createObjectStore('categories', { keyPath: 'id' });
          categories.createIndex('type', 'type');

          db.createObjectStore('recurrenceRules', { keyPath: 'id' });

          // Seed default categories exactly once, on first creation of the
          // store — never re-seeded afterwards, so a user who deletes a
          // default category doesn't see it reappear.
          const now = new Date().toISOString();
          const categoryStore = transaction.objectStore('categories');
          const seed = (names: string[], type: 'income' | 'expense') => {
            names.forEach((name) => {
              const category: FinancialCategory = {
                id: crypto.randomUUID(),
                name,
                type,
                isDefault: true,
                createdAt: now,
                updatedAt: now,
              };
              void categoryStore.put(category);
            });
          };
          seed(DEFAULT_INCOME_CATEGORIES, 'income');
          seed(DEFAULT_EXPENSE_CATEGORIES, 'expense');
        }
      },
    });
  }
  return dbPromise;
}
