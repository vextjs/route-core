import { InvalidStoreIdError } from "../errors.js"

export function assertStoreId(storeId: number): void {
  if (!Number.isSafeInteger(storeId) || storeId < 0) {
    throw new InvalidStoreIdError()
  }
}
