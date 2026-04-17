# DS07 - Audit Model and Persistence

## Rezumat

Se implementează un sistem de audit pentru Explorer și DPU, care colectează evenimente de securitate, operații pe fișiere și interacțiuni cu LLM. Datele sunt persistate în `dpuAgent` ca fișiere JSONL append-only.

## Arhitectură

Sistemul de audit este compus din:
1. **Puncte de captură client-side**: În Explorer, pentru acțiuni UI și Copilot.
2. **Puncte de captură server-side**: În `dpuAgent`, integrate în mutațiile de stare pentru obiecte confidențiale și secrete.
3. **Persistență**: Fișiere `.jsonl` zilnice stocate într-o zonă securizată a agentului.
4. **Control de Acces**: Vizualizarea log-urilor este permisă doar utilizatorilor cu rol `admin` sau `security`.

## Modelul de Date (JSONL)

Fiecare eveniment este o linie JSON cu următoarea structură:
- `timestamp`: ISO 8601
- `eventType`: Tipul evenimentului (ex: `copilot.prompt`, `file.open`)
- `actor`: Informații despre utilizatorul/agentul care a declanșat evenimentul.
- `target`: Resursa afectată (cale, ID obiect).
- `metadata`: Date suplimentare (fără conținut sensibil precum textul fișierelor, dar incluzând prompt-uri/response-uri LLM).
- `status`: `ok` sau `error`.

## Persistență în DPU

Auditul este expus ca un root virtual `/Confidential/Audit`. Fișierele sunt numite după data curentă: `YYYY-MM-DD.jsonl`.

## Controlul de Acces

- **Scriere**: Permisă prin unelte dedicate (`dpu_audit_event_append`) sau automat de către sistem.
- **Citire/Listare**: Permisă doar dacă `authInfo.user.roles` conține `admin` sau `security`. Utilizatorul `local:admin` are acces implicit.
- **Modificare**: Auditul este append-only. Nu există unelte de ștergere sau editare a intrărilor de audit.
