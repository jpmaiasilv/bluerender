import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { Project, ProjectHistoryEntry, ProjectStage, ProjectTag } from './types';

// A separate database from the Financial module's — each module owns its
// own repository and its own store, decoupled from the other, integrating
// only at the service layer (see financialIntegration.ts). This also means
// this upgrade can never touch or risk Financial's existing data.
const DB_NAME = 'blue-render-projects';
const DB_VERSION = 1;

interface ProjectsDB extends DBSchema {
  projects: {
    key: string;
    value: Project;
    indexes: {
      stageId: string;
      dueDate: string;
      priority: string;
      clientId: string;
      responsibleId: string;
      archivedAt: string;
    };
  };
  projectStages: {
    key: string;
    value: ProjectStage;
    indexes: { order: number };
  };
  projectTags: {
    key: string;
    value: ProjectTag;
  };
  projectHistory: {
    key: string;
    value: ProjectHistoryEntry;
    indexes: { projectId: string };
  };
}

const DEFAULT_STAGE_NAMES = ['Briefing', 'Estudo Preliminar', 'Projeto Arquitetônico', 'Projeto Executivo', 'Render', 'Entrega'];

let dbPromise: Promise<IDBPDatabase<ProjectsDB>> | null = null;

export function getProjectsDb(): Promise<IDBPDatabase<ProjectsDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ProjectsDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const projects = db.createObjectStore('projects', { keyPath: 'id' });
          projects.createIndex('stageId', 'stageId');
          projects.createIndex('dueDate', 'dueDate');
          projects.createIndex('priority', 'priority');
          projects.createIndex('clientId', 'clientId');
          projects.createIndex('responsibleId', 'responsibleId');
          projects.createIndex('archivedAt', 'archivedAt');

          const stages = db.createObjectStore('projectStages', { keyPath: 'id' });
          stages.createIndex('order', 'order');

          db.createObjectStore('projectTags', { keyPath: 'id' });

          const history = db.createObjectStore('projectHistory', { keyPath: 'id' });
          history.createIndex('projectId', 'projectId');

          // Seed the default stage flow exactly once, on first creation.
          const now = new Date().toISOString();
          const stageStore = transaction.objectStore('projectStages');
          DEFAULT_STAGE_NAMES.forEach((name, order) => {
            const stage: ProjectStage = { id: crypto.randomUUID(), name, order, createdAt: now, updatedAt: now };
            void stageStore.put(stage);
          });
        }
      },
    });
  }
  return dbPromise;
}
