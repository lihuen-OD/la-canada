import type { EventListItem, PersonRef } from './moreTypes';

export interface DashboardResponse {
  generatedAt: string;
  today: string;
  timeZone: string;
  kpis: {
    tasksCompleted: number;
    tasksTotal: number;
    urgentPending: number;
    stockAlerts: number;
    goodEggsToday: number;
  };
  urgentTasks: { id: string; description: string; assignee: PersonRef }[];
  teamProgress: {
    employee: PersonRef;
    completed: number;
    total: number;
    percentage: number;
  }[];
  stockAlerts: {
    id: string;
    name: string;
    area: 'HOUSE' | 'GARDEN';
    unit: string;
    minimumQuantity: string;
    currentQuantity: string;
    stockLevel: 'low' | 'critical';
  }[];
  upcomingEvents: EventListItem[];
  latestNews: { id: string; text: string; createdAt: string; employee: PersonRef }[];
}
