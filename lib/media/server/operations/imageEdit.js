import { executeImageOperation } from "./image";

export function editImage(input) {
  return executeImageOperation(input, { edit: true });
}
