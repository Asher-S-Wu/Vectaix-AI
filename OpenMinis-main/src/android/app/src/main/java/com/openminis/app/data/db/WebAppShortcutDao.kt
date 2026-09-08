package com.openminis.app.data.db

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update

@Dao
interface WebAppShortcutDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entity: WebAppShortcutEntity)

    @Update
    suspend fun update(entity: WebAppShortcutEntity)

    @Delete
    suspend fun delete(entity: WebAppShortcutEntity)

    @Query("DELETE FROM webapp_shortcuts WHERE id = :id")
    suspend fun deleteById(id: String)

    @Query("SELECT * FROM webapp_shortcuts WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): WebAppShortcutEntity?

    @Query("SELECT * FROM webapp_shortcuts ORDER BY created_at DESC")
    suspend fun getAll(): List<WebAppShortcutEntity>
}
