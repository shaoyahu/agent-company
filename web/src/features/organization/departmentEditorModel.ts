export interface DepartmentEditorInput {
  existing: { id: string } | null;
  name: string;
  englishName: string;
  parentId?: string;
  description?: string;
}

export interface DepartmentEditorValidationInput {
  name: string;
  englishName: string;
}

const DEPARTMENT_ID_RE = /^[a-z0-9_-]+$/i;

export function canSaveDepartmentEditor(input: DepartmentEditorValidationInput): boolean {
  const name = input.name.trim();
  const englishName = input.englishName.trim();
  return name.length > 0 && DEPARTMENT_ID_RE.test(englishName);
}

export function buildDepartmentPayload(input: DepartmentEditorInput) {
  const id = input.existing?.id ?? input.englishName.trim();
  const payload: {
    id: string;
    name: string;
    parentId?: string;
    description?: string;
  } = {
    id,
    name: input.name.trim(),
  };

  const parentId = input.parentId?.trim();
  if (parentId) {
    payload.parentId = parentId;
  }

  const description = input.description?.trim();
  if (description) {
    payload.description = description;
  }

  return payload;
}
