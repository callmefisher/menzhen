import request from '../utils/request';

export function uploadFile(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  return request.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

export function getFileUrl(key: string) {
  return `/api/v1/files/${encodeURIComponent(key)}`;
}
