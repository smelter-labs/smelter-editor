import { v4 as uuidv4 } from 'uuid';

export function createUuid(): string {
  return uuidv4();
}
