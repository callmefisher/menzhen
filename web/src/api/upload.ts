import axios from 'axios';
import request from '../utils/request';

export function uploadFile(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  return request.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

function encodeKey(key: string) {
  return key.split('/').map(encodeURIComponent).join('/');
}

export function getFileUrl(key: string) {
  return `/api/v1/files/${encodeKey(key)}`;
}

export function getFileDownloadUrl(key: string) {
  return `/api/v1/files/${encodeKey(key)}?download=1`;
}

/** Fetch file as blob with JWT auth header, returns a blob URL. */
export async function fetchFileBlob(key: string): Promise<string> {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  const resp = await axios.get(getFileUrl(key), {
    responseType: 'blob',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return URL.createObjectURL(resp.data);
}

/** Download file with JWT auth — creates a temp <a> and clicks it. */
export async function downloadFile(key: string, fileName: string): Promise<void> {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  const resp = await axios.get(getFileDownloadUrl(key), {
    responseType: 'blob',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const url = URL.createObjectURL(resp.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function deleteUploadedFile(filePath: string) {
  return request.delete('/upload', { data: { file_path: filePath } });
}
