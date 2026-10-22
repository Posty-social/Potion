-- Custom SQL migration file, put your code below! --
-- Record uploads made before upload recording existed, so /api/assets can
-- check that the reader belongs to the file's workspace. Each image or video
-- block whose content is an /api/assets/<assetId>/<file> path becomes an
-- asset row for its page's workspace. The size isn't known here (0); the
-- type is inferred from the file extension. INSERT OR IGNORE skips files
-- already recorded (and repeats of the same file).
INSERT OR IGNORE INTO `asset` (
	`id`,
	`organization_id`,
	`r2_key`,
	`mime`,
	`size_bytes`,
	`uploaded_by_user_id`,
	`created_at`
)
SELECT
	substr(path, 1, instr(path, '/') - 1),
	organization_id,
	'assets/' || path,
	CASE
		WHEN lower(path) LIKE '%.png' THEN 'image/png'
		WHEN lower(path) LIKE '%.jpg' OR lower(path) LIKE '%.jpeg' THEN 'image/jpeg'
		WHEN lower(path) LIKE '%.gif' THEN 'image/gif'
		WHEN lower(path) LIKE '%.webp' THEN 'image/webp'
		WHEN lower(path) LIKE '%.avif' THEN 'image/avif'
		WHEN lower(path) LIKE '%.svg' THEN 'image/svg+xml'
		WHEN lower(path) LIKE '%.mp4' THEN 'video/mp4'
		WHEN lower(path) LIKE '%.webm' THEN 'video/webm'
		WHEN lower(path) LIKE '%.mov' THEN 'video/quicktime'
		WHEN type = 'video' THEN 'video/mp4'
		ELSE 'application/octet-stream'
	END,
	0,
	created_by_user_id,
	created_at
FROM (
	SELECT
		-- '<assetId>/<file>': the block content after '/api/assets/'.
		substr(trim(`block`.`content`), length('/api/assets/') + 1) AS path,
		`block`.`type` AS type,
		`page`.`organization_id` AS organization_id,
		`block`.`created_by_user_id` AS created_by_user_id,
		`block`.`created_at` AS created_at
	FROM `block`
	INNER JOIN `page` ON `page`.`id` = `block`.`page_id`
	WHERE `block`.`type` IN ('image', 'video')
		AND trim(`block`.`content`) LIKE '/api/assets/%/%'
)
WHERE instr(path, '/') > 1;
