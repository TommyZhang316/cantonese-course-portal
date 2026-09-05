#!/usr/bin/env python3
"""Prepare an allowlisted, private course import. No network and no source edits.

Run from any directory: python portal/scripts/prepare-materials.py
Dependency: pypdf (only for extracting the student phonetic handout).
The output is deliberately outside public/ and must never be committed.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
import hashlib
import json
import mimetypes
from pathlib import Path, PurePosixPath
import posixpath
import re
import shutil
import sys
import uuid
import xml.etree.ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

PORTAL = Path(__file__).resolve().parents[1]
COURSE = PORTAL.parent
SOURCE = COURSE / "課程成果"
PRIVATE = PORTAL / "private-materials"
HK = timezone(timedelta(hours=8))
NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "urn:musv:cantonese-course:2026:materials")
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
DOC_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
CONTENT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
MIME = {
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pdf": "application/pdf", ".md": "text/markdown", ".txt": "text/plain",
    ".html": "text/html", ".csv": "text/csv",
}
DB_FIELDS = {
    "id", "title", "description", "lesson_id", "category", "student_policy",
    "release_at", "mime_type", "file_size", "file_name", "storage_path",
}
REMOVED_PREFIXES = (
    "ppt/notesslides/", "ppt/notesmasters/", "ppt/comments/",
    "ppt/threadedcomments/", "ppt/persons/", "customxml/", "docprops/",
)


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def under(path: Path, root: Path) -> Path:
    result = path.resolve()
    if result != root.resolve() and root.resolve() not in result.parents:
        raise ValueError(f"Path escapes intended directory: {path}")
    return result


def source_file(relative: str) -> Path:
    path = under(SOURCE / relative, SOURCE)
    if not path.is_file():
        raise FileNotFoundError(f"Expected course source missing: {relative}")
    return path


def match_one(folder: str, pattern: str) -> Path:
    found = sorted((SOURCE / folder).glob(pattern))
    if len(found) != 1:
        raise ValueError(f"Expected exactly one {folder}/{pattern}; found {len(found)}")
    return under(found[0], SOURCE)


def release_for(lesson: dict) -> str:
    day = date.fromisoformat(lesson["date"]) - timedelta(days=7)
    return datetime.combine(day, time(9), HK).isoformat()


def relationship_owner(name: str) -> str:
    if name == "_rels/.rels":
        return ""
    path = PurePosixPath(name)
    if path.parent.name != "_rels":
        raise ValueError(f"Unexpected relationship part: {name}")
    return str(path.parent.parent / path.name.removesuffix(".rels"))


def relationship_target(owner: str, target: str) -> str:
    # Current inputs are ordinary Office packages. Refuse ambiguous escaping.
    if "\\" in target or "%" in target or "?" in target or "#" in target:
        raise ValueError(f"Unexpected internal relationship target: {target}")
    result = posixpath.normpath(posixpath.join(posixpath.dirname(owner), target))
    if target.startswith("/"):
        result = target.lstrip("/")
    if result.startswith("../") or result == "..":
        raise ValueError(f"Relationship escapes package: {target}")
    return result


def xml_bytes(root: ET.Element) -> bytes:
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def forbidden_part(name: str) -> bool:
    lower = name.lower()
    return lower.startswith(REMOVED_PREFIXES) or any(
        item in lower for item in ("commentauthor", "threadedcomment", "person.xml")
    )


def student_pptx(source: Path, target: Path) -> dict:
    """Delete private OOXML parts on a copy; leave every visible slide byte-identical.

    Refuse unexpected embedded objects/macros/external links rather than quietly
    changing visible slide content. All current source decks satisfy this gate.
    """
    with ZipFile(source) as archive:
        if archive.testzip() is not None:
            raise ValueError(f"Corrupt source package: {source.name}")
        parts = {name: archive.read(name) for name in archive.namelist() if not name.endswith("/")}
    if any("embeddings/" in n.lower() or "vbaproject" in n.lower() or "activex/" in n.lower() for n in parts):
        raise ValueError(f"Manual review required: embedded object/macro in {source.name}")
    slides = {n: b for n, b in parts.items() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)}
    if not slides:
        raise ValueError(f"No slides in {source.name}")
    for name, value in slides.items():
        if ET.fromstring(value).get("show") in ("0", "false"):
            raise ValueError(f"Manual review required: hidden slide {source.name}/{name}")
    removed = {name for name in parts if forbidden_part(name)}
    for name in list(parts):
        if name in removed:
            continue
        if name.endswith(".rels"):
            owner = relationship_owner(name)
            if owner in removed:
                removed.add(name)
                continue
            root = ET.fromstring(parts[name])
            changed = False
            removed_ids = set()
            for relationship in list(root):
                if relationship.get("TargetMode") == "External":
                    raise ValueError(f"Manual review required: external link in {source.name}/{name}")
                destination = relationship_target(owner, relationship.attrib["Target"])
                if destination in removed or forbidden_part(destination):
                    root.remove(relationship)
                    removed_ids.add(relationship.attrib["Id"])
                    changed = True
            if changed:
                parts[name] = xml_bytes(root)
                if owner and owner in parts:
                    owner_xml = ET.fromstring(parts[owner])
                    owner_changed = False
                    for parent in owner_xml.iter():
                        for element in list(parent):
                            if any(v in removed_ids for k, v in element.attrib.items() if k.startswith("{" + DOC_REL_NS + "}")):
                                parent.remove(element)
                                owner_changed = True
                    for parent in owner_xml.iter():
                        for element in list(parent):
                            if element.tag == "{" + P_NS + "}notesMasterIdLst" and not list(element):
                                parent.remove(element)
                                owner_changed = True
                    if owner_changed:
                        parts[owner] = xml_bytes(owner_xml)
    for name in removed:
        parts.pop(name, None)
    content_types = ET.fromstring(parts["[Content_Types].xml"])
    for element in list(content_types):
        if element.get("PartName", "").lstrip("/") in removed:
            content_types.remove(element)
    parts["[Content_Types].xml"] = xml_bytes(content_types)
    # A minimal title can identify the student copy without carrying author,
    # company, preview thumbnails, edit history or original custom properties.
    core_name = "docProps/core.xml"
    core = ET.Element("{http://schemas.openxmlformats.org/package/2006/metadata/core-properties}coreProperties")
    title = ET.SubElement(core, "{http://purl.org/dc/elements/1.1/}title")
    title.text = target.stem
    parts[core_name] = xml_bytes(core)
    root_rels = ET.fromstring(parts["_rels/.rels"])
    ids = {item.attrib["Id"] for item in root_rels}
    rid = "rIdStudentCore"
    while rid in ids:
        rid += "1"
    ET.SubElement(root_rels, "{" + REL_NS + "}Relationship", {
        "Id": rid,
        "Type": "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
        "Target": core_name,
    })
    parts["_rels/.rels"] = xml_bytes(root_rels)
    ET.SubElement(content_types, "{" + CONTENT_NS + "}Override", {
        "PartName": "/" + core_name,
        "ContentType": "application/vnd.openxmlformats-package.core-properties+xml",
    })
    parts["[Content_Types].xml"] = xml_bytes(content_types)
    for name, value in slides.items():
        if parts.get(name) != value:
            raise ValueError(f"Visible slide would change: {source.name}/{name}")
    target.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(target, "w", ZIP_DEFLATED) as archive:
        for name in sorted(parts):
            entry = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            archive.writestr(entry, parts[name])
    return validate_student_pptx(target, source)


def validate_student_pptx(path: Path, original: Path | None = None) -> dict:
    with ZipFile(path) as archive:
        names = set(archive.namelist())
        if archive.testzip() is not None:
            raise ValueError(f"Corrupt student package: {path.name}")
        private = {n for n in names if forbidden_part(n) and n != "docProps/core.xml"}
        if private or any("embeddings/" in n.lower() or "vbaproject" in n.lower() for n in names):
            raise ValueError(f"Private parts remain: {private}")
        relationship_count = 0
        for name in names:
            if name.endswith(".xml") or name.endswith(".rels"):
                root = ET.fromstring(archive.read(name))
                if name.endswith(".rels"):
                    ids = set()
                    for relationship in root:
                        relationship_count += 1
                        rid = relationship.attrib["Id"]
                        if rid in ids:
                            raise ValueError(f"Duplicate relationship ID: {name}/{rid}")
                        ids.add(rid)
                        if relationship.get("TargetMode") == "External":
                            raise ValueError(f"External relationship remains: {name}")
                        destination = relationship_target(relationship_owner(name), relationship.attrib["Target"])
                        if destination not in names:
                            raise ValueError(f"Dangling relationship: {name} -> {destination}")
                elif name == "[Content_Types].xml":
                    for item in root:
                        if "PartName" in item.attrib and item.attrib["PartName"].lstrip("/") not in names:
                            raise ValueError("Dangling content type declaration")
                else:
                    rel_ids = [v for element in root.iter() for k, v in element.attrib.items() if k.startswith("{" + DOC_REL_NS + "}")]
                    if rel_ids:
                        part = PurePosixPath(name)
                        rel_name = str(part.parent / "_rels" / (part.name + ".rels"))
                        if rel_name not in names:
                            raise ValueError(f"Missing relationships for {name}")
                        known = {x.attrib["Id"] for x in ET.fromstring(archive.read(rel_name))}
                        if not set(rel_ids).issubset(known):
                            raise ValueError(f"Dangling r:id in {name}")
        slides = sorted(n for n in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", n))
        if original:
            with ZipFile(original) as source:
                original_slides = {n for n in source.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)}
                if set(slides) != original_slides or any(source.read(n) != archive.read(n) for n in slides):
                    raise ValueError("Student slide visuals differ from teacher source")
        return {"slides": len(slides), "relationships_checked": relationship_count,
                "notes_parts": 0, "comment_parts": 0, "external_links": 0,
                "visible_slide_xml_identical": bool(original)}


def phonetic_page(source: Path, target: Path) -> None:
    from pypdf import PdfReader, PdfWriter
    reader = PdfReader(source)
    if len(reader.pages) != 9:
        raise ValueError("Core handout changed; manually review the standalone phonetic page")
    text = reader.pages[0].extract_text()
    if "先學會使用粵拼" not in text or "第1堂 核心詞句" in re.sub(r"\s+", "", text):
        raise ValueError("Unexpected first page; refuse automatic student handout extraction")
    writer = PdfWriter()
    writer.add_page(reader.pages[0])
    writer.add_metadata({"/Title": "拼音銜接表（學生版）"})
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("wb") as output:
        writer.write(output)
    check = PdfReader(target)
    if len(check.pages) != 1 or check.pages[0].extract_text() != text:
        raise ValueError("Extracted phonetic handout does not match original first page")


def prepare() -> dict:
    ignored = (PORTAL / ".gitignore").read_text(encoding="utf-8")
    if not re.search(r"(?m)^/?private-materials/\s*$", ignored):
        raise ValueError("Add private-materials/ to portal/.gitignore before generating")
    under(PRIVATE, PORTAL)
    PRIVATE.mkdir(exist_ok=True)
    raw_lessons = []
    for number in range(1, 9):
        lesson = json.loads((COURSE / "_work" / f"lesson_{number:02d}.json").read_text(encoding="utf-8"))
        if lesson["id"] != number:
            raise ValueError("Lesson IDs do not match input filenames")
        date.fromisoformat(lesson["date"])
        raw_lessons.append(lesson)
    lessons = [{"id": l["id"], "title": l["title"], "summary": " ".join(l["outcomes"]),
                "starts_at": l["date"] + "T18:00:00+08:00", "duration_minutes": 120,
                "sort_order": l["id"]} for l in raw_lessons]
    resources, validations, imported, source_hashes = [], {}, set(), {}

    def add(source: Path, key: str, title: str, category: str, policy: str,
            description: str, lesson_id: int | None = None, release_at: str | None = None,
            file_name: str | None = None, transform: str | None = None) -> None:
        if policy == "scheduled" and not release_at:
            raise ValueError("Scheduled material needs a release timestamp")
        if policy != "scheduled" and release_at is not None:
            raise ValueError("Unscheduled material cannot have a release timestamp")
        resource_id = str(uuid.uuid5(NAMESPACE, key))
        name = file_name or source.name
        original_hash = digest(source)
        source_hashes[str(source.relative_to(SOURCE))] = original_hash
        imported.add(source.resolve())
        file_source = source
        if transform:
            file_source = under(PRIVATE / "derived" / resource_id / name, PRIVATE)
            if transform == "student-pptx":
                validations[resource_id] = student_pptx(source, file_source)
            elif transform == "phonetic-page":
                phonetic_page(source, file_source)
        sha256 = digest(file_source)
        version_id = str(uuid.uuid5(uuid.UUID(resource_id), sha256))
        extension = file_source.suffix.lower()
        storage_path = f"resources/{resource_id}/{version_id}/material{extension}"
        target = under(PRIVATE / storage_path, PRIVATE)
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or digest(target) != sha256:
            shutil.copyfile(file_source, target)
        resources.append({"id": resource_id, "title": title, "description": description,
                          "lesson_id": lesson_id, "category": category, "student_policy": policy,
                          "release_at": release_at, "mime_type": MIME.get(extension) or mimetypes.guess_type(name)[0] or "application/octet-stream",
                          "file_size": target.stat().st_size, "file_name": name,
                          "storage_path": storage_path, "local_path": storage_path,
                          "sha256": sha256})

    for lesson in raw_lessons:
        number = lesson["id"]
        prefix = f"第{number:02d}堂"
        due = release_for(lesson)
        for extension in ("pdf", "docx"):
            add(match_one("02_每課學生筆記", f"{prefix}_*.{extension}"), f"lesson-{number}-notes-{extension}",
                f"第{number}堂・學生筆記（{extension.upper()}）", "notes", "scheduled",
                lesson["title"] + "。課前預習、課堂練習及課後複習。", number, due)
        deck = match_one("03_每課演示文檔", f"{prefix}_*.pptx")
        add(deck, f"lesson-{number}-slides-teacher", f"第{number}堂・教師簡報（含備忘稿）", "slides", "never",
            "含授課提示及練習解答，只供教師備課與授課。", number)
        add(deck, f"lesson-{number}-slides-student", f"第{number}堂・學生簡報", "slides", "scheduled",
            lesson["title"] + "。學生版已移除教師備忘稿與批註，供課前預習及課後複習。", number, due,
            file_name=f"{prefix}_{lesson['title']}_學生版.pptx", transform="student-pptx")

    folder = "01_課程大綱與使用指南"
    for extension in ("pdf", "docx"):
        add(source_file(f"{folder}/課程大綱_修訂標記版.{extension}"), f"syllabus-revised-{extension}",
            f"課程大綱・修訂標記版（{extension.upper()}）", "guide", "immediate",
            "八堂課程安排、評核方式及課務說明。修訂處已標記。")
        add(source_file(f"{folder}/拼音銜接與筆試核心範圍.{extension}"), f"core-scope-{extension}",
            f"拼音銜接與筆試核心範圍（{extension.upper()}）", "guide", "scheduled",
            "已教核心詞句的完整複習表。於第8堂前一週提供，實際考查仍以教師確認的已教內容為準。",
            8, release_for(raw_lessons[7]))
        add(source_file(f"{folder}/材料使用指南_教師與助教版.{extension}"), f"staff-guide-{extension}",
            f"材料使用指南・教師與助教版（{extension.upper()}）", "guide", "never",
            "含教學材料分發、角色卡頁碼、答案位置與期末運作安排，只供授課團隊使用。")
        add(source_file(f"04_教師用書與活動卡/教師用書_流程與全部練習答案.{extension}"), f"teacher-handbook-{extension}",
            f"教師用書・流程與全部練習答案（{extension.upper()}）", "guide", "never",
            "含全部課堂練習及活動參考答案，不向學生提供。")
        add(source_file(f"04_教師用書與活動卡/互動活動卡_分角色列印.{extension}"), f"role-cards-{extension}",
            f"互動活動卡・分角色列印（{extension.upper()}）", "activity", "never",
            "全套角色資訊僅供教師列印分發，避免學生預看其他角色資料。")
        add(source_file(f"06_期末筆試/期末筆試_學生卷.{extension}"), f"exam-student-paper-{extension}",
            f"期末筆試・學生卷（{extension.upper()}）", "exam", "never",
            "正式考卷由教師於考試現場發放，Portal 不預先向學生開放。")
        add(source_file(f"06_期末筆試/期末筆試_教師答案與命題藍圖.{extension}"), f"exam-key-{extension}",
            f"期末筆試・教師答案與命題藍圖（{extension.upper()}）", "exam", "never",
            "正式試卷答案、配分及命題藍圖，只供授課及評核人員使用。")
    add(source_file(f"{folder}/拼音銜接與筆試核心範圍.pdf"), "phonetic-bridge-student", "拼音銜接表・學生版（PDF）",
        "guide", "immediate", "獨立一頁粵拼與教材拼音對照，適合零基礎學生課前閱讀。",
        file_name="拼音銜接表_學生版.pdf", transform="phonetic-page")
    add(source_file("00_原始大綱封存/第三屆內地大學生公益粵語課堂_原始大綱.docx"), "original-syllabus", "原始課程大綱・封存版", "guide", "never",
        "保留修訂前版本供教師核對，學生使用已標記修訂的現行大綱。")
    add(source_file(f"{folder}/教學參考研究.md"), "teaching-research", "教學參考研究", "guide", "never",
        "教師備課研究及來源比較，課堂內容以各課學生材料為準。")
    for name, key, title, category in [
        ("粵語課堂互動遊戲.html", "offline-game", "粵語課堂互動遊戲・教師投影版", "game"),
        ("互動題庫_通用CSV.csv", "quiz-bank", "全課互動題庫・教師版", "game"),
        ("使用說明.txt", "game-instructions", "離線互動遊戲使用說明", "guide"),
    ]:
        add(source_file(f"05_互動遊戲/{name}"), key, title, category, "never",
            "配套全課遊戲與題庫，由教師投影帶領。內含後續課次題目及解答，避免提前洩題。")
    if len({item["id"] for item in resources}) != len(resources):
        raise ValueError("Duplicate resource IDs")
    for relative, original_hash in source_hashes.items():
        if digest(source_file(relative)) != original_hash:
            raise ValueError(f"Source changed during preparation: {relative}")
    manifest = {"schema_version": 1, "lessons": lessons, "resources": resources}
    write_json(PRIVATE / "manifest.json", manifest)
    report = {
        "resource_count": len(resources), "policy_counts": dict(Counter(x["student_policy"] for x in resources)),
        "category_counts": dict(Counter(x["category"] for x in resources)),
        "total_upload_bytes": sum(x["file_size"] for x in resources),
        "student_slide_validation": validations, "original_source_sha256": source_hashes,
        "unimported_course_files": sorted(str(p.relative_to(SOURCE)) for p in SOURCE.rglob("*") if p.is_file() and p.resolve() not in imported),
        "release_schedule": [{"lesson_id": l["id"], "starts_at": l["date"] + "T18:00:00+08:00", "release_at": release_for(l)} for l in raw_lessons],
    }
    write_json(PRIVATE / "preparation-report.json", report)
    verify_manifest()
    return report


def verify_manifest() -> None:
    manifest = json.loads((PRIVATE / "manifest.json").read_text(encoding="utf-8"))
    if manifest["schema_version"] != 1 or len(manifest["lessons"]) != 8:
        raise ValueError("Unexpected manifest format")
    seen = set()
    for resource in manifest["resources"]:
        if set(resource) != DB_FIELDS | {"local_path", "sha256"}:
            raise ValueError("Unexpected resource fields")
        uuid.UUID(resource["id"])
        if resource["id"] in seen:
            raise ValueError("Duplicate resource ID")
        seen.add(resource["id"])
        local_path = resource["local_path"]
        if local_path != resource["storage_path"] or not re.fullmatch(r"resources/[0-9a-f-]{36}/[0-9a-f-]{36}/material\.[a-z0-9]+", local_path):
            raise ValueError("Unsafe resource path")
        path = under(PRIVATE / local_path, PRIVATE)
        if path.stat().st_size != resource["file_size"] or digest(path) != resource["sha256"]:
            raise ValueError(f"Resource checksum mismatch: {resource['title']}")
        if resource["student_policy"] == "scheduled":
            timestamp = datetime.fromisoformat(resource["release_at"])
            if timestamp.utcoffset() != timedelta(hours=8) or timestamp.hour != 9:
                raise ValueError("Default release must be 09:00 Hong Kong time")
        elif resource["student_policy"] not in ("never", "immediate") or resource["release_at"] is not None:
            raise ValueError("Invalid release policy")
        if resource["category"] == "slides" and resource["student_policy"] != "never":
            validate_student_pptx(path, match_one("03_每課演示文檔", f"第{resource['lesson_id']:02d}堂_*.pptx"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-only", action="store_true", help="Verify staged checksums and student OOXML packages without regenerating")
    args = parser.parse_args()
    if args.verify_only:
        verify_manifest()
        print("Private material manifest, checksums and all student PPTX relationships verified.")
    else:
        report = prepare()
        print(json.dumps({"resource_count": report["resource_count"], "policy_counts": report["policy_counts"],
                          "total_upload_bytes": report["total_upload_bytes"], "student_pptx_validated": len(report["student_slide_validation"]),
                          "manifest": "private-materials/manifest.json"}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, FileNotFoundError, KeyError) as error:
        sys.exit(f"Material preparation stopped: {error}")
