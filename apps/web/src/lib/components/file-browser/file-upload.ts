export interface FileUpload {
  file: File
  relativePath: string
}

async function readDirEntry(
  entry: FileSystemDirectoryEntry,
  prefix: string
): Promise<FileUpload[]> {
  const results: FileUpload[] = []
  const reader = entry.createReader()
  let batch: FileSystemEntry[]
  do {
    batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject)
    )
    for (const child of batch) {
      if (child.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (child as FileSystemFileEntry).file(resolve, reject)
        )
        results.push({ file, relativePath: prefix + child.name })
      } else if (child.isDirectory) {
        const sub = await readDirEntry(child as FileSystemDirectoryEntry, prefix + child.name + '/')
        results.push(...sub)
      }
    }
  } while (batch.length > 0)
  return results
}

export async function uploadsFromDataTransfer(dt: DataTransfer): Promise<FileUpload[]> {
  const results: FileUpload[] = []
  const pending: Promise<void>[] = []

  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file') continue
    const entry = item.webkitGetAsEntry()
    if (!entry) continue

    if (entry.isFile) {
      pending.push(
        new Promise<void>((resolve, reject) =>
          (entry as FileSystemFileEntry).file((file) => {
            results.push({ file, relativePath: file.name })
            resolve()
          }, reject)
        )
      )
    } else if (entry.isDirectory) {
      pending.push(
        readDirEntry(entry as FileSystemDirectoryEntry, entry.name + '/').then((uploads) => {
          results.push(...uploads)
        })
      )
    }
  }

  await Promise.all(pending)
  return results
}

export function uploadsFromFileList(files: FileList | File[]): FileUpload[] {
  return Array.from(files).map((file) => ({
    file,
    relativePath: file.webkitRelativePath || file.name,
  }))
}
