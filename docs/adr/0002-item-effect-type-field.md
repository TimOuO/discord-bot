# Item 新增 effectType 欄位，取代靠 type 隱含屬性對應

原本 `Item.effectValue` 要加在哪個屬性上，是靠 `Item.type` 隱含決定的（weapon 加攻擊、armor 加防禦、potion 回血）。為了支援飾品（accessory）——每件飾品可能加不同屬性，不像武器/防具永遠對應同一個屬性——在 `Item` 新增明確的 `effectType` 欄位（例如 `attack`/`defense`/`heal`）。

考慮過只讓 accessory 使用這個欄位、其餘類型維持隱含規則，但那樣裝備/使用道具的邏輯要同時維護兩套對應規則。最後決定所有道具類型都統一改用 `effectType`（武器 `attack`、防具 `defense`、藥水 `heal`），全部道具只用同一套規則判斷效果。
