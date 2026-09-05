export type Role = 'student' | 'teacher' | 'admin';
export type AccountStatus = 'pending' | 'active' | 'suspended';
export type StudentPolicy = 'never' | 'scheduled' | 'immediate';
export type Category = 'notes' | 'slides' | 'activity' | 'game' | 'exam' | 'guide' | 'other';

export interface Account {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  status: AccountStatus;
  updated_at: string;
  version: number;
}
export interface Lesson {
  id: number;
  title: string;
  summary: string;
  starts_at: string | null;
  ends_at: string;
  location: string;
  updated_at: string;
  version: number;
  duration_minutes: number;
  sort_order: number;
}
export interface Resource {
  id: string;
  title: string;
  description: string;
  lesson_id: number | null;
  category: Category;
  student_policy: StudentPolicy;
  release_at: string | null;
  archived_at: string | null;
  file_name: string;
  mime_type: string;
  file_size: number;
  storage_path: string;
  version: number;
  updated_at: string;
}
export interface ResourceInput {
  title: string;
  description: string;
  lesson_id: number | null;
  category: Category;
  student_policy: StudentPolicy;
  release_at: string | null;
}
export interface AuditEntry {
  id: string;
  created_at: string;
  actor_name: string;
  action: string;
  target_label: string;
  detail: string;
}

export interface PortalService {
  readonly configured: boolean;
  readonly demo: boolean;
  session(): Promise<Account | null>;
  onAuthChange(callback: () => void): () => void;
  signIn(email: string, password: string): Promise<Account>;
  signUp(name: string, email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  lessons(): Promise<Lesson[]>;
  resources(): Promise<Resource[]>;
  accounts(): Promise<Account[]>;
  audit(): Promise<AuditEntry[]>;
  download(resource: Resource): Promise<void>;
  saveResource(input: ResourceInput, current?: Resource, file?: File): Promise<void>;
  archiveResource(resource: Resource, archive: boolean): Promise<void>;
  updateAccount(account: Account, role: Role, status: AccountStatus): Promise<void>;
  updateLesson(lesson: Lesson, input: Pick<Lesson,'title'|'summary'|'starts_at'|'ends_at'|'location'|'duration_minutes'>): Promise<void>;
  previewAs?(role: Role): Promise<Account>;
}
