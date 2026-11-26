// Lecture des fichiers importés et partage des exports CSV.
import { Capacitor } from '@capacitor/core';
import { parseCSV } from './logic.js';

/** Lit un fichier Excel (.xlsx) ou CSV et renvoie un tableau de lignes. */
export async function readTable(file) {
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import('read-excel-file/browser');
    const rows = await readSheet(file);
    return rows.map((r) => r.map((c) => (c == null ? '' : c instanceof Date ? c.toLocaleDateString('fr-FR') : String(c))))
      .filter((r) => r.some((x) => x.trim()));
  }
  if (/\.(xls|ods)$/i.test(file.name)) {
    const err = new Error('format');
    err.code = 'old-format';
    throw err;
  }
  const buf = await file.arrayBuffer();
  let t = new TextDecoder('utf-8').decode(buf);
  if (t.includes('�')) t = new TextDecoder('windows-1252').decode(buf); // fichiers CSV enregistrés par Excel
  return parseCSV(t);
}

/**
 * Sur Android : écrit le fichier puis ouvre le menu « Partager » (e-mail, Drive, WhatsApp…).
 * Dans un navigateur : téléchargement classique.
 */
export async function shareFile(filename, text) {
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'), import('@capacitor/share'),
    ]);
    const res = await Filesystem.writeFile({ path: filename, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: filename, files: [res.uri], dialogTitle: 'Envoyer le fichier' });
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
