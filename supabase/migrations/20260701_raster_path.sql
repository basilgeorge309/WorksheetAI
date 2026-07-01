-- Scribbl — pre-rasterized PDF path.
-- PDFs are rasterized to a PNG on-device at upload time (mupdf can't run in the edge
-- function within the 2s CPU limit). This column stores the Storage path of that PNG;
-- the edge function signs it and sends it to OpenAI instead of rasterizing itself.
-- Null for image uploads (they use storage_path directly) and for older PDF rows.
--
-- Run on dev AND prod. Safe to re-run.

alter table public.worksheets
  add column if not exists raster_path text;

comment on column public.worksheets.raster_path is
  'Storage path of the on-device-rendered PNG for a PDF upload (null for images).';
