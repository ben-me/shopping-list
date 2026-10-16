ALTER TABLE `items` ADD `position` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `items` SET `position` = (
  SELECT COUNT(*) - 1 FROM `items` AS `earlier`
  WHERE `earlier`.`list_id` = `items`.`list_id`
    AND (`earlier`.`created_at` < `items`.`created_at`
      OR (`earlier`.`created_at` = `items`.`created_at` AND `earlier`.`rowid` <= `items`.`rowid`))
);
