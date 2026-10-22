import { api } from './api';

export async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  return (await api<{ url: string }>('/uploads/image', { form })).url;
}
