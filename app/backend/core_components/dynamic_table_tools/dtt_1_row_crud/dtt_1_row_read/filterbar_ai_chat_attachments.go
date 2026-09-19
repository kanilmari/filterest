// filterbar_ai_chat_attachments.go
// Accepts the images an administrator attaches to a dataset chat question.
// Bridges the chat's upload, the waiting-attachment store and the assistant job.
// Exists so the assistant can look at a screenshot the person is asking about,
// while the browser only ever handles an opaque token, never a path.
package dtt_1_row_read

import (
	"io"
	"net/http"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/site_assistant"
)

// maxChatAttachmentRequestBytes bounds one upload request, including the
// multipart framing around the image itself.
const maxChatAttachmentRequestBytes = site_assistant.MaxAttachmentBytes + (1 << 20)

// ChatAttachmentHandler stores one image for the asking administrator and
// answers with the token that names it in the next question. The image is kept
// only on this machine and only until the question is asked or it expires.
func ChatAttachmentHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST accepted")
		return
	}
	actor, ok := dbutils.GetRequestActorContext(r.Context())
	if !ok || !actor.IsAdmin || actor.UserID <= 1 {
		httpresponse.RespondWithError(w, http.StatusForbidden, "administrator access is required")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxChatAttachmentRequestBytes)
	file, header, err := r.FormFile("image")
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "one image file is required")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, site_assistant.MaxAttachmentBytes+1))
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "the image could not be read")
		return
	}

	name := ""
	if header != nil {
		name = header.Filename
	}
	attachment, err := site_assistant.DefaultAttachments.Accept(actor.UserID, name, data)
	if err != nil {
		switch err {
		case site_assistant.ErrAttachmentTooMany:
			httpresponse.RespondWithError(w, http.StatusConflict, "too many images are already attached")
		case site_assistant.ErrAttachmentUnsupported:
			httpresponse.RespondWithError(w, http.StatusBadRequest, "only PNG, JPEG, WebP and GIF images are accepted")
		default:
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "the image could not be stored")
		}
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"token":      attachment.Token,
		"name":       attachment.Name,
		"expires_at": attachment.ExpiresAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	})
}

// resolveCodingAgentImages turns the tokens of one question into the paths the
// runner reads. The files stay until they expire, because the separate runner
// process copies them into its own workspace only once the job starts.
func resolveCodingAgentImages(actor int, tokens []string) ([]codingAgentImage, error) {
	if len(tokens) == 0 {
		return nil, nil
	}
	if len(tokens) > site_assistant.MaxAttachmentsPerActor {
		return nil, site_assistant.ErrAttachmentTooMany
	}
	images := make([]codingAgentImage, 0, len(tokens))
	for _, token := range tokens {
		attachment, err := site_assistant.DefaultAttachments.Resolve(actor, token)
		if err != nil {
			return nil, err
		}
		images = append(images, codingAgentImage{Path: attachment.Path, Name: attachment.Name})
	}
	return images, nil
}
